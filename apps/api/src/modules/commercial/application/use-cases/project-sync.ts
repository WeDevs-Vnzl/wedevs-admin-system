import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { ClientMetricsWriterPort } from '../../../../shared/application/ports/client-metrics-writer.port';
import type {
  SearchIndexEntry,
  SearchIndexPort,
} from '../../../../shared/application/ports/search-index.port';
import type { ActivityChanges } from '../../../../shared/domain/activity-diff';
import type { ActivityAction } from '../../../../shared/domain/enums';
import { earliestClientId, projectSearchDocument, type ProjectRecord } from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';

export interface ProjectLogExtra {
  readonly changes?: ActivityChanges | null;
  readonly metadata?: Readonly<Record<string, unknown>>;
  /** Clients that left the project: their `lastActivityAt` moves too. */
  readonly alsoTouch?: readonly string[];
}

type ProjectEntrySource = Pick<ProjectRepository, 'clientRefs' | 'clientLegalNames'>;

/**
 * The `SearchEntry` of a project: code, name, status, the trade names of its clients (subtitle) and, in
 * front of the summary and description text, their legal names, because the list searches both (DT-153).
 * Archived clients count (A11). The one builder of the write path and of the `PROJECT` reindex source.
 */
export async function projectEntryOf(
  source: ProjectEntrySource,
  record: ProjectRecord,
): Promise<SearchIndexEntry> {
  const ids = record.clients.map((link) => link.clientId);
  const [refs, legalNames] = await Promise.all([
    source.clientRefs(ids),
    source.clientLegalNames(ids),
  ]);
  const names = ids
    .map((id) => refs.find((ref) => ref.id === id)?.label)
    .filter((label): label is string => label !== undefined);
  const legal = ids
    .map((id) => legalNames.get(id))
    .filter((label): label is string => label !== undefined);
  const document = projectSearchDocument(record, names);
  const body = [...legal, ...(document.body ? [document.body] : [])].join('\n');
  return {
    entityType: 'PROJECT',
    entityId: record.id,
    code: document.code,
    title: document.title,
    subtitle: document.subtitle,
    body: body.length > 0 ? body : null,
    status: document.status,
    archived: record.archivedAt !== null,
  };
}

/**
 * The side effects every project mutation runs in its own unit of work (C12): the activity entry, the
 * search entry and the `projectCount` of the linked clients. Valid only inside `UnitOfWorkPort.run`.
 */
export class ProjectSync {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly searchIndex: SearchIndexPort,
    private readonly clientMetrics: ClientMetricsWriterPort,
    private readonly activityLog: ActivityLogPort,
  ) {}

  /** `clientId` = the earliest link; every linked client gets its `lastActivityAt` bumped (Q-BE2-2). */
  async log(
    actor: CurrentUser,
    action: ActivityAction,
    record: ProjectRecord,
    extra: ProjectLogExtra = {},
  ): Promise<void> {
    const linked = record.clients.map((link) => link.clientId);
    const touch = [...new Set([...linked, ...(extra.alsoTouch ?? [])])];
    await this.activityLog.record({
      actor: actorOf(actor),
      action,
      entityType: 'PROJECT',
      entityId: record.id,
      entityLabel: record.name,
      clientId: earliestClientId(record.clients),
      ...(touch.length > 0 ? { touchClientIds: touch } : {}),
      ...(extra.changes ? { changes: extra.changes } : {}),
      ...(extra.metadata ? { metadata: extra.metadata } : {}),
    });
  }

  /** Writes the search entry: code, name, client names, summary and description text. */
  async reindex(record: ProjectRecord): Promise<void> {
    await this.searchIndex.upsert(await projectEntryOf(this.projects, record));
  }

  /**
   * Sets `ClientMetrics.projectCount` of each client to its live project count. The client rows are
   * locked first (ascending id), so two recounts of one client run one after the other and the second
   * counts what the first committed; a use case that already locked them (project → clients) waits for
   * nothing here.
   */
  async recount(clientIds: readonly string[]): Promise<void> {
    await this.projects.lockClients(clientIds);
    for (const clientId of [...new Set(clientIds)].sort()) {
      await this.clientMetrics.setProjectCount(
        clientId,
        await this.projects.countLiveProjectsOfClient(clientId),
      );
    }
  }
}
