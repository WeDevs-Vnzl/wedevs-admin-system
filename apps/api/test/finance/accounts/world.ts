import { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import type { ExchangeRatePort } from '../../../src/modules/finance/application/ports/exchange-rate.port';
import type { FinanceSourcesPort } from '../../../src/modules/finance/application/ports/finance-sources.port';
import type { ReadModelWriterPort } from '../../../src/modules/finance/application/ports/read-model-writer.port';
import type {
  AccountPartner,
  AccountPartnersPort,
} from '../../../src/modules/finance/application/ports/account-partners.port';
import { CreateAccount } from '../../../src/modules/finance/application/use-cases/accounts/create-account.use-case';
import { CreateMovement } from '../../../src/modules/finance/application/use-cases/accounts/create-movement.use-case';
import { CreateTransfer } from '../../../src/modules/finance/application/use-cases/accounts/create-transfer.use-case';
import { GetAccount } from '../../../src/modules/finance/application/use-cases/accounts/get-account.use-case';
import { GetAccountBalance } from '../../../src/modules/finance/application/use-cases/accounts/get-account-balance.use-case';
import { GetAccountLedger } from '../../../src/modules/finance/application/use-cases/accounts/get-account-ledger.use-case';
import { ListAccountPartners } from '../../../src/modules/finance/application/use-cases/accounts/list-account-partners.use-case';
import { ListAccounts } from '../../../src/modules/finance/application/use-cases/accounts/list-accounts.use-case';
import { ReconcileAccount } from '../../../src/modules/finance/application/use-cases/accounts/reconcile-account.use-case';
import { UpdateAccount } from '../../../src/modules/finance/application/use-cases/accounts/update-account.use-case';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { accountBalance } from '../../../src/modules/finance/domain/accounts';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryAccountRepository } from './fakes/in-memory-account.repository';

/** 2026-10-09 in Caracas: the "today" of the mock's account fixtures. */
export const NOW = '2026-10-09T16:00:00.000Z';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

export async function rejection(promise: Promise<unknown>): Promise<{
  code?: string;
  fieldErrors?: Record<string, string[]>;
}> {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error('expected the promise to reject');
}

/** Units of each currency per 1 USD, as the mock fixtures: 1 USDT = 1.01 USD. */
const RATES: Record<string, string> = { USD: '1', USDT: '0.9901', VES: '755.16', EUR: '0.86' };

/** The rates, projector sources and writer the world needs, all backed by the in-memory repository. */
function projectionPorts(repository: InMemoryAccountRepository) {
  const sources = {
    accountSource: async (id: string) => {
      const activity = repository.activityOf(id);
      return activity && { id, activity };
    },
    transferFacts: async (id: string) => {
      const transfer = repository.transfers.find((t) => t.id === id);
      return (
        transfer && {
          id,
          archived: false,
          date: transfer.date,
          fromAccountId: transfer.fromAccountId,
          toAccountId: transfer.toAccountId,
          amountUsd: transfer.amountUsd,
        }
      );
    },
    movementFacts: async (id: string) => {
      const movement = repository.movements.find((m) => m.id === id);
      return (
        movement && {
          id,
          archived: false,
          date: movement.date,
          accountId: movement.accountId,
          type: movement.type,
          amountUsd: movement.amountUsd,
        }
      );
    },
  } as unknown as FinanceSourcesPort;
  const facts: { sourceType: string; sourceId: string; kinds: string[] }[] = [];
  const writer = {
    replaceFacts: async (sourceType: string, sourceId: string, rows: { kind: string }[]) => {
      facts.push({ sourceType, sourceId, kinds: rows.map((row) => row.kind) });
    },
    writeAccountBalance: async (id: string, balance: string) => repository.setBalance(id, balance),
  } as unknown as ReadModelWriterPort;
  return { sources, writer, facts };
}

/** The accounts use cases over in-memory ports and the real permission matrix. */
export function createWorld() {
  const uow = new InMemoryUnitOfWork();
  const repository = new InMemoryAccountRepository(uow);
  const activity = new InMemoryActivityLog(uow);
  const search = new InMemorySearchIndex(uow);
  const locks = new InMemoryRowLocks(uow);
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator('acc');
  const authorization = new MatrixAuthorization();
  const { sources, writer, facts } = projectionPorts(repository);
  const projector = new FinanceProjector(sources, writer, clock);
  const rates: ExchangeRatePort = {
    getRateFor: async (date, currency) => {
      const usdRate = RATES[currency];
      return usdRate === undefined
        ? null
        : {
            usdRate,
            source: currency === 'USD' ? null : 'MANUAL',
            isFallback: false,
            effectiveDate: date,
            options: [],
          };
    },
  };
  const catalog = new Set(['USD', 'USDT', 'VES', 'EUR', 'GBP']);
  const currencies = {
    knownCodes: async (codes: readonly string[]) =>
      new Set(codes.filter((code) => catalog.has(code))),
  };
  const partnerList: AccountPartner[] = [
    { id: 'usr_andres', name: 'Andrés Molina' },
    { id: 'usr_laura', name: 'Laura Pérez' },
  ];
  const partners: AccountPartnersPort = {
    find: async (id) => partnerList.find((partner) => partner.id === id) ?? null,
    list: async () => partnerList,
  };
  return {
    uow,
    locks,
    repository,
    activity,
    search,
    clock,
    facts,
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),
    createAccount: new CreateAccount(
      authorization,
      uow,
      repository,
      projector,
      search,
      activity,
      clock,
      ids,
      currencies,
      rates,
    ),
    updateAccount: new UpdateAccount(
      authorization,
      uow,
      locks,
      repository,
      projector,
      search,
      activity,
      clock,
      currencies,
      rates,
    ),
    getAccount: new GetAccount(authorization, repository, rates, clock),
    listAccounts: new ListAccounts(authorization, repository, rates, clock),
    getLedger: new GetAccountLedger(authorization, repository),
    getBalance: new GetAccountBalance(authorization, repository, sources, rates, clock),
    reconcile: new ReconcileAccount(
      authorization,
      uow,
      locks,
      repository,
      sources,
      activity,
      clock,
      ids,
    ),
    createTransfer: new CreateTransfer(
      authorization,
      uow,
      locks,
      repository,
      projector,
      activity,
      clock,
      ids,
    ),
    createMovement: new CreateMovement(
      authorization,
      uow,
      locks,
      repository,
      partners,
      projector,
      activity,
      clock,
      ids,
    ),
    listPartners: new ListAccountPartners(authorization, partners),
    /** `Account.balance` the projector cached, and what the domain calculates from the sources. */
    balanceOf: (id: string) => repository.accounts.find((account) => account.id === id)?.balance,
    computedBalance: (id: string) =>
      accountBalance(repository.activityOf(id) as never, '9999-12-31'),
  };
}

export type World = ReturnType<typeof createWorld>;

/** The accounts of the mock fixtures: Zelle USD 1200, Binance USDT 99, Banco VES 3500 (HU-15 CA1). */
export async function seedMockAccounts(
  world: World,
): Promise<{ zelle: string; binance: string; ves: string }> {
  const { owner } = world;
  const open = (
    name: string,
    type: 'BILLETERA_DIGITAL' | 'WALLET_CRIPTO' | 'BANCO_NACIONAL',
    currency: string,
    openingBalance: string,
  ) =>
    world.createAccount.execute(owner, {
      name,
      type,
      currency,
      openingBalance,
      openingDate: '2026-01-01',
    });
  const zelle = await open('Zelle USD', 'BILLETERA_DIGITAL', 'USD', '1000.00');
  const binance = await open('Binance USDT', 'WALLET_CRIPTO', 'USDT', '0.00');
  const ves = await open('Banco nacional VES', 'BANCO_NACIONAL', 'VES', '5000.00');
  await world.createMovement.execute(owner, {
    accountId: zelle.id,
    type: 'APORTE_CAPITAL',
    date: '2026-02-01',
    amount: '500.00',
    usdRate: '1',
    partnerId: 'usr_andres',
    description: 'Aporte',
  });
  await world.createMovement.execute(owner, {
    accountId: zelle.id,
    type: 'RETIRO_SOCIO',
    date: '2026-03-01',
    amount: '200.00',
    usdRate: '1',
    partnerId: 'usr_laura',
    description: 'Retiro',
  });
  await world.createTransfer.execute(owner, {
    date: '2026-04-01',
    fromAccountId: zelle.id,
    toAccountId: binance.id,
    amountFrom: '100.00',
    amountTo: '99.00',
    feeAmount: '0',
    usdRate: '1',
  });
  await world.createMovement.execute(owner, {
    accountId: ves.id,
    type: 'AJUSTE',
    date: '2026-05-01',
    amount: '-1500.00',
    usdRate: '755.16',
    description: 'Ajuste',
  });
  return { zelle: zelle.id, binance: binance.id, ves: ves.id };
}
