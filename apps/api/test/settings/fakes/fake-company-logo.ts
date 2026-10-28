import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { CompanyLogoPort } from '../../../src/modules/settings/application/ports/company-logo.port';

/** Fake `CompanyLogoPort`: only the ids added with `markReady` can be the logo. */
export class FakeCompanyLogo implements CompanyLogoPort {
  private readonly ready = new Set<string>();
  calls = 0;
  lastActor: CurrentUser | null = null;

  markReady(fileId: string): void {
    this.ready.add(fileId);
  }

  async canBeLogo(actor: CurrentUser, fileId: string): Promise<boolean> {
    this.calls += 1;
    this.lastActor = actor;
    return this.ready.has(fileId);
  }
}
