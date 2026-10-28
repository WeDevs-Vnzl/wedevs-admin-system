import type {
  FileAccessClaim,
  FileAccessResolver,
} from '../../platform/application/ports/file-access.port';
import type { SettingRepository } from '../application/ports/setting.repository';
import { COMPANY_SETTING_KEY, companyProfileFromStored } from '../domain/company-settings';

/**
 * Registers the company logo in platform's file access registry: whoever is signed in may download the
 * file the company profile currently points to (Q-BE1-3). Any other file is not this context's.
 */
export class CompanyLogoFileAccessResolver implements FileAccessResolver {
  constructor(private readonly settings: SettingRepository) {}

  async resolve(fileId: string): Promise<FileAccessClaim | null> {
    const stored = await this.settings.find(COMPANY_SETTING_KEY);
    const { logoFileId } = companyProfileFromStored(stored?.value);
    return logoFileId !== null && logoFileId === fileId ? { kind: 'authenticated' } : null;
  }
}
