import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ClientMetricsWriterPort } from '../../../../shared/application/ports/client-metrics-writer.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { SearchIndexPort } from '../../../../shared/application/ports/search-index.port';
import type { SequencePort } from '../../../../shared/application/ports/sequence.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ConflictError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import { CLIENT_STATUS_VALUES, type ClientStatus } from '../../../../shared/domain/enums';
import type { TagAssignments } from '../../../settings/application/tag-assignments';
import {
  CLIENT_DUPLICATE_TAX_ID_KEY,
  clientSearchEntry,
  normalizeClient,
  toClientRef,
  type ClientDetailView,
  type ClientInput,
  type ClientRecord,
} from '../../domain/client';
import { FIELD_KEYS } from '../../domain/client-fields';
import type { ClientRepository } from '../ports/client.repository.port';
import type { ContactRepository } from '../ports/contact.repository.port';
import { clientTarget, readClientDetail } from './client-support';

export type CreateClientInput = ClientInput & { readonly status?: ClientStatus };

/**
 * `POST /clients` (HU-03). Order: `can(create, client)` → form rules (CA1) → one `Serializable` unit of
 * work: normalized tax id + country must be free among live clients (`CONFLICT` linking the holder, CA3),
 * `CLI-####` from the sequence (CA2), insert, tags through `TagAssignments`, `CREATE` activity with the
 * `clientId`, search entry and `ClientMetrics` row (CA4). A rollback consumes no sequence value.
 */
export class CreateClient {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clients: ClientRepository,
    private readonly contacts: ContactRepository,
    private readonly assignments: TagAssignments,
    private readonly activityLog: ActivityLogPort,
    private readonly searchIndex: SearchIndexPort,
    private readonly metrics: ClientMetricsWriterPort,
    private readonly sequence: SequencePort,
    private readonly clock: ClockPort,
    private readonly ids: IdGeneratorPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateClientInput): Promise<ClientDetailView> {
    assertCan(this.authorization, actor, 'create', 'client');
    const { values, tagIds } = normalizeClient(input);
    const status = input.status ?? 'PROSPECTO';
    if (!(CLIENT_STATUS_VALUES as readonly string[]).includes(status)) {
      throw new ValidationFailedError({ fieldErrors: { status: [FIELD_KEYS.invalidOption] } });
    }

    return this.uow.run(
      async () => {
        const holder = await this.clients.findTaxIdHolder(values.taxId, values.country);
        if (holder) {
          throw new ConflictError({
            message: CLIENT_DUPLICATE_TAX_ID_KEY,
            entity: toClientRef(holder),
          });
        }
        const now = this.clock.now();
        const record: ClientRecord = {
          ...values,
          id: this.ids.next(),
          code: await this.sequence.next('CLI'),
          status,
          activatedAt: status === 'ACTIVO' ? now : null,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        };
        await this.clients.insert(record);
        await this.assignments.replace(actor, clientTarget(record.id), tagIds);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'CREATE',
          entityType: 'CLIENT',
          entityId: record.id,
          entityLabel: record.tradeName,
          clientId: record.id,
          metadata: { code: record.code },
        });
        await this.searchIndex.upsert(clientSearchEntry(record));
        await this.metrics.ensure(record.id);
        return readClientDetail(this.contacts, this.assignments, record);
      },
      { isolation: 'Serializable' },
    );
  }
}
