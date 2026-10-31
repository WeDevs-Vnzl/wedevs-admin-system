import type { CurrentUser } from '../../../../../shared/application/current-user';
import {
  assertCan,
  type AuthorizationPort,
} from '../../../../../shared/application/ports/authorization.port';
import type { AccountPartner, AccountPartnersPort } from '../../ports/account-partners.port';

/** Users who can be the partner behind a contribution or withdrawal (PRD §8.7). */
export class ListAccountPartners {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly partners: AccountPartnersPort,
  ) {}

  async execute(actor: CurrentUser): Promise<AccountPartner[]> {
    assertCan(this.authorization, actor, 'read', 'account');
    return this.partners.list();
  }
}
