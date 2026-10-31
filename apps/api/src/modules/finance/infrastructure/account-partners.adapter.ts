import { Inject, Injectable } from '@nestjs/common';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
import { FinanceLookups } from '../../commercial/application/finance-lookups';
import type {
  AccountPartner,
  AccountPartnersPort,
} from '../application/ports/account-partners.port';

/**
 * `AccountPartnersPort` over `commercial`'s exported `FinanceLookups` (a partner id sent by the caller is
 * never trusted, C14) plus a read-only list of the live users for the partner picker. The list is a read of
 * `User` that identity exports no application API for (reported against DT-118).
 */
@Injectable()
export class AccountPartnersAdapter implements AccountPartnersPort {
  constructor(
    @Inject(FinanceLookups) private readonly lookups: FinanceLookups,
    @Inject(TransactionHost) private readonly host: TransactionHost,
  ) {}

  async find(userId: string): Promise<AccountPartner | null> {
    const partner = await this.lookups.partnerRef(userId);
    return partner && { id: partner.id, name: partner.label };
  }

  async list(): Promise<AccountPartner[]> {
    const users = await this.host.db.user.findMany({
      select: { id: true, name: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return users;
  }
}
