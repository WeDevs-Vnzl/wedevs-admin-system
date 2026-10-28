import type { CurrentUser } from '../../../../shared/application/current-user';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import {
  assertCurrencyCode,
  currencyCreationChanges,
  normalizeCurrencyFields,
  type Currency,
  type CurrencyFieldsInput,
} from '../../domain/currency';
import type { CurrencyRepository } from '../ports/currency.repository.port';

export type CreateCurrencyInput = CurrencyFieldsInput & { readonly code: string };

/**
 * Adds a currency (PRD §8.15). Order: `can(create, settings)` → validate the code and the fields → one unit of
 * work that inserts the row and logs one `SETTINGS_CHANGE`. A code that is already stored surfaces as
 * `CONFLICT` on the code from the repository.
 */
export class CreateCurrency {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly currencies: CurrencyRepository,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: CreateCurrencyInput): Promise<Currency> {
    assertCan(this.authorization, actor, 'create', 'settings');
    assertCurrencyCode(input.code);
    const currency: Currency = { code: input.code, ...normalizeCurrencyFields(input) };

    return this.uow.run(async () => {
      await this.currencies.insert(currency);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: currency.code,
        entityLabel: currency.name,
        changes: currencyCreationChanges(currency.code),
      });
      return currency;
    });
  }
}
