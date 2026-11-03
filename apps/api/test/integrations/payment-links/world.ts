import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import { CreateInvoicePaymentLink } from '../../../src/modules/integrations/application/use-cases/payment-links/create-invoice-payment-link.use-case';
import { DeactivateInvoicePaymentLink } from '../../../src/modules/integrations/application/use-cases/payment-links/deactivate-invoice-payment-link.use-case';
import { DeactivatePaymentLinksBeyondBalance } from '../../../src/modules/integrations/application/use-cases/payment-links/deactivate-payment-links-beyond-balance.use-case';
import { ListInvoicePaymentLinks } from '../../../src/modules/integrations/application/use-cases/payment-links/list-invoice-payment-links.use-case';
import type { MappedAccountCurrencyPort } from '../../../src/modules/integrations/application/use-cases/payment-links/stripe-link-target.port';
import type { InvoiceForLink } from '../../../src/modules/integrations/application/ports/invoice-for-link.port';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryIntegrationMapping } from '../../support/fakes/in-memory-integration-mapping';
import { InMemoryInvoiceForPaymentLink } from '../../support/fakes/in-memory-invoice-for-payment-link';
import { InMemoryPaymentLinkRepository } from '../../support/fakes/in-memory-payment-link-repository';
import { InMemoryPaymentProvider } from '../../support/fakes/in-memory-payment-provider';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';

export const userOf = (role: CurrentUser['role'], name = role.toLowerCase()): CurrentUser => ({
  userId: `usr_${name}`,
  clerkId: `clerk_${name}`,
  role,
  email: `${name}@example.test`,
  name,
});
export const owner = userOf('OWNER');
export const member = userOf('MEMBER');
export const viewer = userOf('VIEWER');

export const REQ_1 = '11111111-1111-4111-8111-111111111111';
export const REQ_2 = '22222222-2222-4222-8222-222222222222';
export const REQ_3 = '33333333-3333-4333-8333-333333333333';

export const invoiceOf = (over: Partial<InvoiceForLink> = {}): InvoiceForLink => ({
  id: 'inv_1',
  number: 'F-001',
  clientId: 'cli_1',
  currency: 'USD',
  openBalance: '100.00',
  open: true,
  ...over,
});

/** A provider whose next `createPaymentLink` / `deactivatePaymentLink` calls can be scripted to fail. */
export class ScriptedProvider extends InMemoryPaymentProvider {
  failCreate = 0;
  failDeactivate = 0;
  readonly createKeys: string[] = [];
  readonly deactivated: string[] = [];

  override async createPaymentLink(
    input: Parameters<InMemoryPaymentProvider['createPaymentLink']>[0],
  ) {
    this.createKeys.push(input.idempotencyKey);
    if (this.failCreate > 0) {
      this.failCreate -= 1;
      throw new Error('provider down');
    }
    return super.createPaymentLink(input);
  }

  override async deactivatePaymentLink(externalId: string): Promise<void> {
    if (this.failDeactivate > 0) {
      this.failDeactivate -= 1;
      throw new Error('provider down');
    }
    this.deactivated.push(externalId);
    return super.deactivatePaymentLink(externalId);
  }
}

/** Fake `MappedAccountCurrencyPort`: the currency of each known active account; absent ids answer `null`. */
export class FakeMappedAccounts implements MappedAccountCurrencyPort {
  readonly currencies = new Map<string, string>([['acc_stripe', 'USD']]);

  async currencyOf(_actor: CurrentUser, accountId: string): Promise<string | null> {
    return this.currencies.get(accountId) ?? null;
  }
}

export interface WorldOptions {
  readonly lockDecorator?: (locks: RowLocksPort) => RowLocksPort;
}

export function buildWorld(options: WorldOptions = {}) {
  const uow = new InMemoryUnitOfWork();
  const rowLocks = new InMemoryRowLocks(uow);
  const locks = options.lockDecorator ? options.lockDecorator(rowLocks) : rowLocks;
  const activity = new InMemoryActivityLog(uow);
  const clock = new FixedClock('2026-11-02T12:00:00.000Z');
  const ids = new SequentialIdGenerator('lnk');
  const invoices = new InMemoryInvoiceForPaymentLink();
  const links = new InMemoryPaymentLinkRepository();
  const provider = new ScriptedProvider();
  const authorization = new MatrixAuthorization();
  const mapping = new InMemoryIntegrationMapping({
    stripe: { accountId: 'acc_stripe', paymentMethodId: 'pm_stripe' },
  });
  const accounts = new FakeMappedAccounts();
  invoices.add(invoiceOf());
  return {
    uow,
    rowLocks,
    activity,
    clock,
    invoices,
    links,
    provider,
    mapping,
    accounts,
    create: new CreateInvoicePaymentLink(
      authorization,
      uow,
      invoices,
      links,
      provider,
      locks,
      activity,
      ids,
      clock,
      mapping,
      accounts,
    ),
    list: new ListInvoicePaymentLinks(authorization, invoices, links, mapping, accounts),
    deactivate: new DeactivateInvoicePaymentLink(
      authorization,
      uow,
      links,
      provider,
      locks,
      activity,
      clock,
    ),
    sweep: new DeactivatePaymentLinksBeyondBalance(
      uow,
      invoices,
      links,
      provider,
      locks,
      activity,
      clock,
    ),
  };
}
export type World = ReturnType<typeof buildWorld>;
