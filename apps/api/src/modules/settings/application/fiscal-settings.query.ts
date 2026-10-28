import {
  FISCAL_SETTING_KEY,
  fiscalFromStored,
  type FiscalSettings,
} from '../domain/fiscal-settings';
import type { SettingRepository } from './ports/setting.repository';

/**
 * Reads the fiscal parameters from the `fiscal` row of `Setting` (DT-44, DT-70). Exported for BE-3, which uses
 * the allowed VAT rates, the default rate, the IGTF rate and currencies and the default due days in its tax
 * and invoice rules. Read-only: it never writes and carries no `can()` (reference catalog read, DT-71).
 */
export class FiscalSettingsQuery {
  constructor(private readonly settings: SettingRepository) {}

  async read(): Promise<FiscalSettings> {
    const stored = await this.settings.find(FISCAL_SETTING_KEY);
    return fiscalFromStored(stored?.value);
  }
}
