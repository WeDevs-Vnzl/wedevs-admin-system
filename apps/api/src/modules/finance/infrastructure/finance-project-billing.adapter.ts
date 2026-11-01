import type {
  ProjectBillingPort,
  ProjectCancelOptions,
  ProjectCancelResult,
} from '../../commercial/application/ports/project-billing.port';
import type { RowLocksPort } from '../../../shared/application/ports/row-locks.port';
import { NotFoundError } from '../../../shared/domain/domain-error';
import type { ProjectBillingApi } from '../application/use-cases/billing/project-billing.api';

/** What the adapter asks of commercial's `FinanceLookups`: the clients of a live project. */
export interface ProjectClientsLookup {
  liveProject(id: string): Promise<{ readonly clientIds: readonly string[] } | null>;
}

type BillingApi = Pick<
  ProjectBillingApi,
  | 'hasActiveBilling'
  | 'hasBillingPlan'
  | 'hasActiveRecurringCharge'
  | 'lockSet'
  | 'cancelForProject'
>;

/**
 * `commercial`'s `ProjectBillingPort` over finance's exported `ProjectBillingApi` (HU-08 CA3, Q-BE2-1).
 *
 * `cancelForProject` is the **one** `RowLocksPort.lock` call of the caller's transaction (global lock order,
 * Q-BE3-1): the project, its clients and `ProjectBillingApi.lockSet`. The caller (`SetProjectStatus`) has
 * already locked the project row with `FOR UPDATE` and opened the outermost unit of work `Serializable`, so
 * every billing writer (which locks the project first) is excluded while the ids are read, and re-locking the
 * project here only repeats a lock this transaction holds. The API then joins that unit of work.
 */
export class FinanceProjectBilling implements ProjectBillingPort {
  constructor(
    private readonly billing: BillingApi,
    private readonly projects: ProjectClientsLookup,
    private readonly locks: RowLocksPort,
  ) {}

  hasActiveBilling(projectId: string): Promise<boolean> {
    return this.billing.hasActiveBilling(projectId);
  }

  hasBillingPlan(projectId: string): Promise<boolean> {
    return this.billing.hasBillingPlan(projectId);
  }

  hasActiveRecurringCharge(projectId: string): Promise<boolean> {
    return this.billing.hasActiveRecurringCharge(projectId);
  }

  async cancelForProject(
    projectId: string,
    options: ProjectCancelOptions,
  ): Promise<ProjectCancelResult> {
    const project = await this.projects.liveProject(projectId);
    if (project === null) throw new NotFoundError();
    await this.locks.lock({
      Project: [projectId],
      Client: project.clientIds,
      ...(await this.billing.lockSet(projectId)),
    });
    return this.billing.cancelForProject(projectId, options);
  }
}
