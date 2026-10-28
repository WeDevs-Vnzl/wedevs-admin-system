import type { CurrentUser } from '../../../../shared/application/current-user';
import { actorOf } from '../../../../shared/application/actor';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import {
  FISCAL_ACTIVITY_ID,
  FISCAL_MESSAGES,
  FISCAL_SETTING_KEY,
  fiscalChanges,
  fiscalFromStored,
  normalizeFiscalSettings,
  type FiscalSettings,
  type FiscalSettingsInput,
} from '../../domain/fiscal-settings';
import type { CurrencyRepository } from '../ports/currency.repository.port';
import type { SettingRepository } from '../ports/setting.repository';

/**
 * Replaces the fiscal parameters: the allowed VAT rates and the default one (DT-44), the IGTF rate and the
 * currencies that propose it (DT-70), the default due days. Order: `can(update, settings)` → validate the fields
 * → one unit of work that checks every IGTF currency against the catalog (including inactive ones), reads the
 * stored row, writes it and logs one `SETTINGS_CHANGE` only when something changed.
 */
export class UpdateFiscalSettings {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly settings: SettingRepository,
    private readonly currencies: CurrencyRepository,
    private readonly activityLog: ActivityLogPort,
  ) {}

  async execute(actor: CurrentUser, input: FiscalSettingsInput): Promise<FiscalSettings> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const next = normalizeFiscalSettings(input);

    return this.uow.run(async () => {
      const known = new Set((await this.currencies.list()).map((row) => row.code));
      if (next.igtfCurrencies.some((code) => !known.has(code))) {
        throw new ValidationFailedError({
          fieldErrors: { igtfCurrencies: [FISCAL_MESSAGES.unknownCurrency] },
        });
      }

      const stored = await this.settings.find(FISCAL_SETTING_KEY);
      const before = fiscalFromStored(stored?.value);
      const changes = fiscalChanges(before, next);
      if (changes === null) return before;

      await this.settings.save(FISCAL_SETTING_KEY, { ...next });
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: FISCAL_ACTIVITY_ID,
        entityLabel: FISCAL_ACTIVITY_ID,
        changes,
      });
      return next;
    });
  }
}
