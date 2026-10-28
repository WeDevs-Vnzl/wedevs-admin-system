import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../shared/application/ports/authorization.port';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import {
  COMPANY_SETTING_KEY,
  INVALID_ID_KEY,
  companyProfileChanges,
  companyProfileFromStored,
  normalizeCompanyProfile,
  type CompanyProfile,
  type CompanyProfileInput,
} from '../../domain/company-settings';
import type { CompanyLogoPort } from '../ports/company-logo.port';
import type { SettingRepository } from '../ports/setting.repository';

/**
 * Replaces the company profile (PRD §8.15). Order: `can(update, settings)` → validate and normalize →
 * logo check (a new logo must be the caller's own unattached ready image, DT-109) → one unit of work that reads the stored row, writes it and logs `SETTINGS_CHANGE` only when
 * the change set is not empty.
 */
export class UpdateCompanySettings {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly uow: UnitOfWorkPort,
    private readonly settings: SettingRepository,
    private readonly activityLog: ActivityLogPort,
    private readonly logos: CompanyLogoPort,
  ) {}

  async execute(actor: CurrentUser, input: CompanyProfileInput): Promise<CompanyProfile> {
    assertCan(this.authorization, actor, 'update', 'settings');
    const next = normalizeCompanyProfile(input);

    if (next.logoFileId !== null && !(await this.logoIsAcceptable(actor, next.logoFileId))) {
      throw new ValidationFailedError({ fieldErrors: { logoFileId: [INVALID_ID_KEY] } });
    }

    return this.uow.run(async () => {
      const stored = await this.settings.find(COMPANY_SETTING_KEY);
      const changes = companyProfileChanges(companyProfileFromStored(stored?.value), next);
      if (changes === null) return next;

      await this.settings.save(COMPANY_SETTING_KEY, next);
      await this.activityLog.record({
        actor: actorOf(actor),
        action: 'SETTINGS_CHANGE',
        entityType: 'SETTING',
        entityId: COMPANY_SETTING_KEY,
        entityLabel: next.name,
        changes,
      });
      return next;
    });
  }

  /**
   * Keeping the current logo always passes (it is already claimed by settings, so it no longer looks
   * unattached to platform). A new logo must satisfy `CompanyLogoPort.canBeLogo` for the caller (DT-109).
   */
  private async logoIsAcceptable(actor: CurrentUser, fileId: string): Promise<boolean> {
    const stored = await this.settings.find(COMPANY_SETTING_KEY);
    if (companyProfileFromStored(stored?.value).logoFileId === fileId) return true;
    return this.logos.canBeLogo(actor, fileId);
  }
}
