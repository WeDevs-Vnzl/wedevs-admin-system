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

/**
 * Edits a payment method. Its code is the stable identifier and never changes. Order: `can(update, settings)` →
 * validate → load (`NOT_FOUND`) → one unit of work that refuses another method's name (`CONFLICT`), writes and
 * logs `SETTINGS_CHANGE` only when something changed.
 */
export class UpdatePaymentMethod {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly methods: PaymentMethodRepository,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    id: string,
    input: PaymentMethodFieldsInput,
  ): Promise<PaymentMethod> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fields = normalizePaymentMethodFields(input);

    return this.uow.run(async () => {
      const before = await this.methods.findById(id);
      if (!before) throw new NotFoundError();
      assertUniquePaymentMethod(await this.methods.list(), { name: fields.name }, id);

      const changes = paymentMethodChanges(before, fields);
      if (changes === null) return before;

      const after: PaymentMethod = { ...before, ...fields };
      await this.methods.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: after.id,
        entityLabel: after.name,
        changes,
      });
      return after;
    });
  }
}
