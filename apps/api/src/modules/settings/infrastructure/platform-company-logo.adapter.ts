import type { CurrentUser } from '../../../shared/application/current-user';
import type { GetFileSummary } from '../../platform/application/use-cases/get-file-summary.use-case';
import type { CompanyLogoPort } from '../application/ports/company-logo.port';

/** Settings' `CompanyLogoPort` answered by platform's exported `GetFileSummary` (boundary rule e). */
export class PlatformCompanyLogoAdapter implements CompanyLogoPort {
  constructor(private readonly summary: GetFileSummary) {}

  async canBeLogo(actor: CurrentUser, fileId: string): Promise<boolean> {
    const file = await this.summary.execute(actor, fileId);
    return (
      file !== null &&
      file.status === 'READY' &&
      file.mimeType.startsWith('image/') &&
      file.uploadedById === actor.userId &&
      !file.attached
    );
  }
}
