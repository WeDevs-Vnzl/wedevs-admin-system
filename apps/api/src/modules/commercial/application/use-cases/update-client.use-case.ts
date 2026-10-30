import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { SearchIndexPort } from '../../../../shared/application/ports/search-index.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import {
  CLIENT_DUPLICATE_TAX_ID_KEY,
  clientChanges,
  clientSearchEntry,
  normalizeClient,
  toClientRef,
  type ClientDetailView,
  type ClientInput,
  type ClientRecord,
} from '../../domain/client';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { clientTarget, readClientDetail, tagNamesOf } from './client-support';

/**
 * `PATCH /clients/{id}` (HU-03). The body is the full editable state; the status changes through
 * `SetClientStatus`. Order: `can(update, client)` → form rules → one `Serializable` unit of work: load a
 * live client (`NOT_FOUND`), the same tax id + country uniqueness excluding itself, tags, then diff. No
 * write, no activity and no reindex when nothing changed; otherwise `UPDATE` with the changed fields
 * (`address` as "changed", tags as names) and a reindex.
 */
export class UpdateClient {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: ClientInput & { readonly id: string },
  ): Promise<ClientDetailView> {
    assertCan(this.authorization, actor, 'update', 'client');
    const { values, tagIds } = normalizeClient(input);

    return this.uow.run(
      async () => {
        const before = await this.clients.findById(input.id);
        if (!before || before.deletedAt) throw new NotFoundError();
        const holder = await this.clients.findTaxIdHolder(values.taxId, values.country, before.id);
        if (holder) {
          throw new ConflictError({
            message: CLIENT_DUPLICATE_TAX_ID_KEY,
            entity: toClientRef(holder),
          });
        }

        const target = clientTarget(before.id);
        const namesBefore = await tagNamesOf(this.assignments, target);
        await this.assignments.replace(actor, target, tagIds);
        const namesAfter = await tagNamesOf(this.assignments, target);

        const changes = clientChanges(before, values, { before: namesBefore, after: namesAfter });
        if (changes === null) return readClientDetail(this.contacts, this.assignments, before);

        const after: ClientRecord = { ...before, ...values, updatedAt: this.clock.now() };
        await this.clients.update(after);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'UPDATE',
          entityType: 'CLIENT',
          entityId: after.id,
          entityLabel: after.tradeName,
          clientId: after.id,
          changes,
        });
        await this.searchIndex.upsert(clientSearchEntry(after));
        return readClientDetail(this.contacts, this.assignments, after);
      },
      { isolation: 'Serializable' },
    );
  }
}
