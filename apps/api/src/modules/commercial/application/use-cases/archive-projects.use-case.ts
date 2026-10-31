import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { SearchIndexPort } from '../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { IntegrityLockedError } from '../../../../shared/domain/domain-error';
import { PROJECT_KEYS, type ArchivedProjectView, type ProjectRecord } from '../../domain/project';
import type { ProjectBillingPort } from '../ports/project-billing.port';
import type { ProjectRepository } from '../ports/project.repository.port';
import { loadLiveProject, reloadProject } from './project-references';
import type { ProjectSync } from './project-sync';

export interface ArchiveProjectsInput {
  readonly ids: readonly string[];
  readonly confirm: boolean;
}

/**
 * `POST /projects/{id}/archive` and `POST /projects/archive` (single = bulk of one; all or nothing).
 * Order: `can(delete, project)` → one unit of work: every project must be live (`NOT_FOUND`) and, unless
 * `confirm`, have no active billing (`ProjectBillingPort`, `INTEGRITY_LOCK` `projects.errors.archiveNeedsConfirm`
 * with `entity`); then the rows are archived with the same `deletedAt`, one `DELETE` entry each, the
 * search entries are archived and the `projectCount` of every linked client is recounted. The first
 * failure rolls everything back.
 */
export class ArchiveProjects {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly projects: ProjectRepository,
    private readonly billing: ProjectBillingPort,
    private readonly sync: ProjectSync,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(actor: CurrentUser, input: ArchiveProjectsInput): Promise<ArchivedProjectView[]> {
    assertCan(this.authorization, actor, 'delete', 'project');
    const ids = [...new Set(input.ids)];

    return this.uow.run(async () => {
      // Locked in ascending id order, so two bulk archives that overlap cannot wait on each other.
      const locked = new Map<string, ProjectRecord>();
      for (const id of [...ids].sort()) locked.set(id, await loadLiveProject(this.projects, id));
      const records = ids.flatMap((id) => locked.get(id) ?? []);
      // Then the clients of all of them in one ascending batch (lock order: projects → clients).
      await this.projects.lockClients(records.flatMap((r) => r.clients.map((l) => l.clientId)));
      if (!input.confirm) {
        for (const record of records) {
          if (await this.billing.hasActiveBilling(record.id)) {
            throw new IntegrityLockedError({
              message: PROJECT_KEYS.archiveNeedsConfirm,
              entity: { type: 'PROJECT', id: record.id, code: record.code, label: record.name },
            });
          }
        }
      }

      const at = this.clock.now();
      await this.projects.setArchived(ids, at, actor.userId);
      const clientIds: string[] = [];
      for (const record of records) {
        const archived = await reloadProject(this.projects, record.id);
        await this.sync.log(actor, 'DELETE', archived, { metadata: { code: archived.code } });
        await this.searchIndex.setArchived('PROJECT', archived.id, true);
        clientIds.push(...archived.clients.map((link) => link.clientId));
      }
      await this.sync.recount(clientIds);
      return records.map((record) => ({ id: record.id, archivedAt: at }));
    });
  }
}
