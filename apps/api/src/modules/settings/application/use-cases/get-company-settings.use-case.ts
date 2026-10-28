import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  COMPANY_SETTING_KEY,
  companyProfileFromStored,
  type CompanyProfile,
} from '../../domain/company-settings';
import type { SettingRepository } from '../ports/setting.repository';

/** Output model of the company profile queries and commands (interface layers import it from here). */
export type CompanySettingsOutput = CompanyProfile;

/**
 * Reads the company profile. Authorization is the route's `@Authenticated()` declaration (DT-71, DT-79,
 * Q-BE1-3): every signed-in user may read the company, the portal and print views show it. There is no
 * `can()` action for "any signed-in user", so the use case checks nothing beyond the actor it receives.
 */
export class GetCompanySettings {
  constructor(private readonly settings: SettingRepository) {}

  async execute(_actor: CurrentUser): Promise<CompanyProfile> {
    const stored = await this.settings.find(COMPANY_SETTING_KEY);
    return companyProfileFromStored(stored?.value);
  }
}
