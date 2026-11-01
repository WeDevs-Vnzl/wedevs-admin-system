import type { Actor } from '../../../../../shared/application/actor';
import type {
  ActivityEntry,
  ActivityLogPort,
} from '../../../../../shared/application/ports/activity-log.port';
import type {
  RowLockSet,
  RowLocksPort,
} from '../../../../../shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../../shared/domain/domain-error';
import type { FinanceProjector } from '../../finance-projector';
import type { BillingProject, BillingProjectsPort } from '../../ports/billing-projects.port';

/** The part of the projector billing uses: the metrics of the project's clients and of the project. */
export type BillingProjector = Pick<FinanceProjector, 'projectClients' | 'projectProjects'>;

/** One activity entry before the transaction fills the client scope of its project. */
export type ActivityDraft = Omit<ActivityEntry, 'actor' | 'clientId' | 'touchClientIds'>;

export interface BillingOutcome<T> {
  readonly value: T;
  /** False when nothing was written: the projections and the activity are skipped. */
  readonly changed: boolean;
  readonly activity: readonly ActivityDraft[];
}

/**
 * A project-scoped money mutation of billing (Q-BE3-1, C18). One `Serializable` unit of work whose first
 * statement takes every row lock up front through `RowLocksPort`, in the global order:
 * `Project` → `Client` → the caller's own rows. Then the caller's `work`, then the projections in the
 * documented order (the project's clients, then the project), then the activity entries.
 *
 * The project is read once before the unit of work to learn the clients to lock, and again after the locks:
 * a project that was archived meanwhile is `NOT_FOUND`, and one whose clients changed meanwhile is a
 * `CONFLICT` (the caller retries), so the lock set can never be out of date.
 */
export class BillingTransaction {
  constructor(
    private readonly uow: UnitOfWorkPort,
    private readonly locks: RowLocksPort,
    private readonly projects: BillingProjectsPort,
    private readonly projector: BillingProjector,
    private readonly activityLog: ActivityLogPort,
  ) {}

  /** The live project, or `NOT_FOUND` (unknown and archived ids look the same, C14). */
  async requireProject(projectId: string): Promise<BillingProject> {
    const project = await this.projects.liveProject(projectId);
    if (project === null) throw new NotFoundError();
    return project;
  }

  async run<T>(
    actor: Actor,
    projectId: string,
    own: Omit<RowLockSet, 'Project' | 'Client'>,
    work: (project: BillingProject) => Promise<BillingOutcome<T>>,
  ): Promise<T> {
    const first = await this.projects.liveProject(projectId);
    if (first === null) throw new NotFoundError();
    return this.uow.run(
      async () => {
        await this.locks.lock({ ...own, Project: [first.id], Client: first.clientIds });
        const project = await this.projects.liveProject(projectId);
        if (project === null) throw new NotFoundError();
        if (project.clientIds.some((id) => !first.clientIds.includes(id)))
          throw new ConflictError();

        const outcome = await work(project);
        if (!outcome.changed) return outcome.value;
        await this.projector.projectClients(project.clientIds);
        await this.projector.projectProjects([project.id]);
        for (const draft of outcome.activity) {
          await this.activityLog.record({
            ...draft,
            actor,
            clientId: project.clientIds[0] ?? null,
            touchClientIds: project.clientIds,
          });
        }
        return outcome.value;
      },
      { isolation: 'Serializable' },
    );
  }
}
