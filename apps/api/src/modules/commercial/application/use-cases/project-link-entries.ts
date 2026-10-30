import type { ActivityAction } from '../../../../shared/domain/enums';
import type { ActivityChanges } from '../../../../shared/domain/activity-diff';
import { diffClientLinks, type ProjectClientLink } from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';

export interface ClientLinkEntry {
  readonly action: ActivityAction;
  readonly changes?: ActivityChanges;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly alsoTouch?: readonly string[];
}

/**
 * The activity entries of the client-link changes between `before` and `after`: `LINK` when a client
 * appears, `UNLINK` when it goes, `UPDATE` with `clientRole` when only its role changes (the mock's
 * `logClientLinks`). An unlinked client still gets its `lastActivityAt` bumped.
 */
export async function clientLinkEntries(
  projects: ProjectRepository,
  before: readonly ProjectClientLink[],
  after: readonly ProjectClientLink[],
): Promise<ClientLinkEntry[]> {
  const changes = diffClientLinks(before, after);
  if (changes.length === 0) return [];
  const refs = await projects.clientRefs(changes.map((change) => change.clientId));
  const label = (clientId: string): string =>
    refs.find((ref) => ref.id === clientId)?.label ?? clientId;
  return changes.map((change) => {
    const metadata = {
      linkedType: 'CLIENT',
      linkedId: change.clientId,
      linkedLabel: label(change.clientId),
      role: change.role,
    };
    if (change.kind === 'LINK') return { action: 'LINK', metadata };
    if (change.kind === 'UNLINK') {
      return { action: 'UNLINK', metadata, alsoTouch: [change.clientId] };
    }
    return {
      action: 'UPDATE',
      changes: { clientRole: [change.previousRole, change.role] },
      metadata,
    };
  });
}
