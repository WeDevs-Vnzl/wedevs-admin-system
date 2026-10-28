import type { CurrentUser } from '../../../../shared/application/current-user';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  assertPaymentMethodCode,
  assertUniquePaymentMethod,
  normalizePaymentMethodFields,
  paymentMethodCreationChanges,
  type PaymentMethod,
  type PaymentMethodFieldsInput,
} from '../../domain/payment-method';
import type { PaymentMethodRepository } from '../ports/payment-method.repository.port';

export type CreatePaymentMethodInput = PaymentMethodFieldsInput & { readonly code: string };

/**
 * Adds a payment method (PRD §8.15). Order: `can(create, settings)` → validate the code and the fields → one unit
 * of work that refuses a repeated code or name (`CONFLICT`), inserts the row with a generated id and logs one
 * `SETTINGS_CHANGE`.
 */
export class CreatePaymentMethod {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly methods: PaymentMethodRepository,
    private readonly ids: IdGeneratorPort,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: CreatePaymentMethodInput): Promise<PaymentMethod> {
    assertCan(this.authorization, actor, 'create', 'settings');
    assertPaymentMethodCode(input.code);
    const fields = normalizePaymentMethodFields(input);

    return this.uow.run(async () => {
      assertUniquePaymentMethod(await this.methods.list(), { code: input.code, name: fields.name });
      const method: PaymentMethod = { id: this.ids.next(), code: input.code, ...fields };
      await this.methods.insert(method);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: method.id,
        entityLabel: method.name,
        changes: paymentMethodCreationChanges(method.code),
      });
      return method;
    });
  }
}
