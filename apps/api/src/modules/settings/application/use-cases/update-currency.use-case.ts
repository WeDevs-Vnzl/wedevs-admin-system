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
  assertCurrencyActivation,
  currencyChanges,
  normalizeCurrencyFields,
  type Currency,
  type CurrencyFieldsInput,
} from '../../domain/currency';
import type { CurrencyRepository } from '../ports/currency.repository.port';

/**
 * Edits a currency: its name, symbol, decimals and active flag; the code is the key and never changes (C19:
 * deactivate, never delete). Order: `can(update, settings)` → validate the fields → load (`NOT_FOUND`) → USD
 * stays active → one unit of work that writes and logs `SETTINGS_CHANGE` only when something changed.
 */
export class UpdateCurrency {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly currencies: CurrencyRepository,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, code: string, input: CurrencyFieldsInput): Promise<Currency> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const fields = normalizeCurrencyFields(input);

    return this.uow.run(async () => {
      const before = await this.currencies.findByCode(code);
      if (!before) throw new NotFoundError();
      assertCurrencyActivation(code, fields.active);

      const changes = currencyChanges(before, fields);
      if (changes === null) return before;

      const after: Currency = { code, ...fields };
      await this.currencies.update(after);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: code,
        entityLabel: after.name,
        changes,
      });
      return after;
    });
  }
}
