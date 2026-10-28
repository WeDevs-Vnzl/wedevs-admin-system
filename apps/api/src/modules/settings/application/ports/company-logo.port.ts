import type { CurrentUser } from '../../../../shared/application/current-user';

/**
 * Settings' own view of the company logo file (PRD §8.15, Q-BE1-3, DT-109). Settings does not import the
 * platform files context: the adapter that answers this question is bound in the settings module.
 */
export interface CompanyLogoPort {
  /**
   * True only when `fileId` names a stored `READY` image that `actor` uploaded and that is not attached
   * anywhere else. Once it is the logo, every signed-in user may download it, so nothing else qualifies.
   */
  canBeLogo(actor: CurrentUser, fileId: string): Promise<boolean>;
}

export const COMPANY_LOGO = Symbol('COMPANY_LOGO');
