import { actorOf } from '../../../shared/application/actor';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError, type FieldErrors } from '../../../shared/domain/domain-error';
import {
  INTEGRATION_MAPPING_KEY,
  INTEGRATION_MAPPING_MESSAGES as MESSAGES,
  mappingChanges,
  mappingFromStored,
  type IntegrationMappingInput,
  type IntegrationMappingQuery,
  type IntegrationMappingReferences,
  type IntegrationMappingSettings,
} from './integration-mapping';
import type { SettingRepository } from './ports/setting.repository';

const WALLET_TYPE = 'WALLET_CRIPTO';

const id = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

/** `GET /settings/integrations`: the `settings` `read` grant (PRD §4.3). */
export class GetIntegrationMapping {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly query: IntegrationMappingQuery,
  ) {}

  async execute(actor: CurrentUser): Promise<IntegrationMappingSettings> {
    assertCan(this.authorization, actor, 'read', 'settings');
    return this.query.read();
  }
}

/**
 * `PUT /settings/integrations`: replaces the whole mapping. Order: `can(update, settings)` → resolve every id
 * (C14: accounts exist and are active, the Binance one is a `WALLET_CRIPTO`, the method is active) → one unit
 * of work that reads the stored row, writes it and logs one `SETTINGS_CHANGE` only when something changed.
 */
export class UpdateIntegrationMapping {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly settings: SettingRepository,
    private readonly references: IntegrationMappingReferences,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(
    actor: CurrentUser,
    input: IntegrationMappingInput,
  ): Promise<IntegrationMappingSettings> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const next = await this.resolve(actor, input);

    return this.uow.run(async () => {
      const stored = await this.settings.find(INTEGRATION_MAPPING_KEY);
      const before = mappingFromStored(stored?.value);
      const changes = mappingChanges(before, next);
      if (changes === null) return before;
      await this.settings.save(INTEGRATION_MAPPING_KEY, next);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: INTEGRATION_MAPPING_KEY,
        entityLabel: INTEGRATION_MAPPING_KEY,
        changes,
      });
      return next;
    });
  }

  private async resolve(
    actor: CurrentUser,
    input: IntegrationMappingInput,
  ): Promise<IntegrationMappingSettings> {
    const errors: FieldErrors = {};
    let stripe: IntegrationMappingSettings['stripe'] = null;
    let binance: IntegrationMappingSettings['binance'] = null;

    if (input.stripe) {
      const accountId = id(input.stripe.accountId);
      const paymentMethodId = id(input.stripe.paymentMethodId);
      if (!accountId) errors['stripe.accountId'] = [MESSAGES.invalidId];
      else if (!(await this.references.account(actor, accountId))?.active) {
        errors['stripe.accountId'] = [MESSAGES.accountNotFound];
      }
      if (!paymentMethodId) errors['stripe.paymentMethodId'] = [MESSAGES.invalidId];
      else if (!(await this.references.methodIsActive(paymentMethodId))) {
        errors['stripe.paymentMethodId'] = [MESSAGES.methodInvalid];
      }
      if (accountId && paymentMethodId) stripe = { accountId, paymentMethodId };
    }
    if (input.binance) {
      const accountId = id(input.binance.accountId);
      if (!accountId) errors['binance.accountId'] = [MESSAGES.invalidId];
      else {
        const account = await this.references.account(actor, accountId);
        if (!account?.active) errors['binance.accountId'] = [MESSAGES.accountNotFound];
        else if (account.type !== WALLET_TYPE)
          errors['binance.accountId'] = [MESSAGES.accountNotWallet];
        else binance = { accountId };
      }
    }
    if (Object.keys(errors).length > 0) throw new ValidationFailedError({ fieldErrors: errors });
    return { stripe, binance };
  }
}
