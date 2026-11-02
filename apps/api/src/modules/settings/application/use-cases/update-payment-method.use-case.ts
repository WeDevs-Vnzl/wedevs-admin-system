import type { CurrentUser } from '../../../../shared/application/current-user';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import {
  assertUniquePaymentMethod,
  normalizePaymentMethodFields,
  paymentMethodChanges,
  type PaymentMethod,
  type PaymentMethodFieldsInput,
} from '../../domain/payment-method';
import type { PaymentMethodRepository } from '../ports/payment-method.repository.port';
import type { PaymentMethodSearchDependentsPort } from '../ports/payment-method-search-dependents.port';

/**
 * Edits a payment method. Its code is the stable identifier and never changes. Order: `can(update, settings)` →
 * validate → load (`NOT_FOUND`) → one `Serializable` unit of work (X18: the unit of work retries it, and a
 * concurrent payment that read the old name forms the cycle Postgres aborts) that refuses another method's name
 * (`CONFLICT`), writes, rewrites the method name in the dependants' search entries when `name` changed (DT-166,
 * before the activity entry) and logs `SETTINGS_CHANGE` only when something changed.
 */
export class UpdatePaymentMethod {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly methods: PaymentMethodRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly dependents: PaymentMethodSearchDependentsPort,
  ) {}

  async execute(
    actor: CurrentUser,
    id: string,
    input: PaymentMethodFieldsInput,
  ): Promise<PaymentMethod> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fields = normalizePaymentMethodFields(input);

    return this.uow.run(
      async () => {
        const before = await this.methods.findById(id);
        if (!before) throw new NotFoundError();
        assertUniquePaymentMethod(await this.methods.list(), { name: fields.name }, id);

        const changes = paymentMethodChanges(before, fields);
        if (changes === null) return before;

        const after: PaymentMethod = { ...before, ...fields };
        await this.methods.update(after);
        if (after.name !== before.name) await this.dependents.relabelMethod(after.id, after.name);
        await this.activityLog.record({
          actor: actorOf(actor),
          action: 'SETTINGS_CHANGE',
          entityType: 'SETTING',
          entityId: after.id,
          entityLabel: after.name,
          changes,
        });
        return after;
      },
      { isolation: 'Serializable' },
    );
  }
}
