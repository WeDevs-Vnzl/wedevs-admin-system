import { Inject, Injectable, Module } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import { integrationsOf, type AppConfig, type WorkerConfig } from '../../config/env.schema';
import type { CurrentUser } from '../../shared/application/current-user';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { AUTHORIZATION, CLOCK, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import { DEFAULT_LIST_QUERY } from '../../shared/domain/list-query';
import type { Prisma } from '../../shared/infrastructure/prisma/generated-client';
import { TransactionHost } from '../../shared/infrastructure/prisma/transaction-host';
import { AccountsModule } from '../finance/accounts.module';
import { ListAccounts } from '../finance/application/use-cases/accounts/list-accounts.use-case';
import { EXCHANGE, type ExchangePort } from './application/ports/exchange.port';
import {
  INTEGRATION_EVENT_STORE,
  type IntegrationEventStore,
} from './application/ports/integration-event-store.port';
import {
  INTEGRATION_MAPPING,
  type IntegrationMappingPort,
} from './application/ports/integration-mapping.port';
import {
  EXCHANGE_SNAPSHOT_STORE,
  WALLET_ACCOUNT_BALANCE,
  type ExchangeSnapshotStore,
  type StoredExchangeSnapshot,
  type WalletAccountBalance,
  type WalletAccountBalancePort,
} from './application/use-cases/exchange/exchange-snapshot.ports';
import { GetExchangeSnapshot } from './application/use-cases/exchange/get-exchange-snapshot.use-case';
import { SyncExchangeAccount } from './application/use-cases/exchange/sync-exchange-account.use-case';
// The rule (j) pattern `binance/**` also matches our own adapter folder; the SDK itself is never imported here.
import { BinanceExchange } from './infrastructure/binance/binance-exchange';
import { ExchangeSnapshotController } from './interface/http/exchange-snapshot.controller';

/** `Setting` key of the last Binance snapshot (DT-184). */
export const EXCHANGE_SNAPSHOT_SETTING_KEY = 'integrations.binance.snapshot';

/** The snapshot as `Setting` JSON: ISO timestamp and the exchange's own amount strings. */
@Injectable()
export class SettingExchangeSnapshotStore implements ExchangeSnapshotStore {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  async load(): Promise<StoredExchangeSnapshot | null> {
    const row = await this.host.db.setting.findUnique({
      where: { key: EXCHANGE_SNAPSHOT_SETTING_KEY },
    });
    return parseSnapshot(row?.value);
  }

  async save(snapshot: StoredExchangeSnapshot): Promise<void> {
    const value = {
      syncedAt: snapshot.syncedAt.toISOString(),
      balances: snapshot.balances.map(({ asset, free, locked }) => ({ asset, free, locked })),
    } satisfies Prisma.InputJsonObject;
    await this.host.db.setting.upsert({
      where: { key: EXCHANGE_SNAPSHOT_SETTING_KEY },
      create: { key: EXCHANGE_SNAPSHOT_SETTING_KEY, value },
      update: { value },
    });
  }
}

/** A stored value that is not a well-formed snapshot reads as "no snapshot yet". */
export function parseSnapshot(value: unknown): StoredExchangeSnapshot | null {
  if (typeof value !== 'object' || value === null) return null;
  const { syncedAt, balances } = value as Record<string, unknown>;
  if (typeof syncedAt !== 'string' || !Array.isArray(balances)) return null;
  const at = new Date(syncedAt);
  if (Number.isNaN(at.getTime())) return null;
  const rows: StoredExchangeSnapshot['balances'][number][] = [];
  for (const row of balances as unknown[]) {
    if (typeof row !== 'object' || row === null) return null;
    const { asset, free, locked } = row as Record<string, unknown>;
    if (typeof asset !== 'string' || typeof free !== 'string' || typeof locked !== 'string') {
      return null;
    }
    rows.push({ asset, free, locked });
  }
  return { syncedAt: at, balances: rows };
}

const PAGE_SIZE = 100;

/** The ledger balance of one account, found through finance's exported `ListAccounts` (DT-110). */
export class FinanceWalletAccountBalance implements WalletAccountBalancePort {
  constructor(private readonly accounts: ListAccounts) {}

  async balanceOf(actor: CurrentUser, accountId: string): Promise<WalletAccountBalance | null> {
    for (let page = 1; ; page += 1) {
      const result = await this.accounts.execute(actor, {
        ...DEFAULT_LIST_QUERY,
        page,
        pageSize: PAGE_SIZE,
        filters: { includeInactive: 'true' },
      });
      const found = result.items.find((account) => account.id === accountId);
      if (found) {
        return {
          currency: found.currency,
          balance: found.balance,
          balanceUsd: found.balanceUsd,
        };
      }
      if (page >= result.pageCount) return null;
    }
  }
}

/**
 * Binance wallet snapshot (DT-184): `SyncExchangeAccount` for the worker, `GetExchangeSnapshot` and
 * `GET /accounts/{id}/exchange-snapshot` for the API. Feature module; package 4.1 imports it.
 *
 * Needs two tokens from the module that binds the integration adapters: `INTEGRATION_MAPPING` and
 * `INTEGRATION_EVENT_STORE`. `EXCHANGE` is `null` while `BINANCE_API_KEY` and `BINANCE_API_SECRET` are not
 * both set, and then `SyncExchangeAccount` is `null` too: the integration is off (DT-193) and the worker does
 * not register `exchange-sync`.
 */
@Module({
  imports: [AccountsModule],
  controllers: [ExchangeSnapshotController],
  providers: [
    {
      provide: EXCHANGE,
      useFactory: (config: AppConfig | WorkerConfig, clock: ClockPort): ExchangePort | null => {
        const binance = integrationsOf(config).binance;
        return binance
          ? new BinanceExchange({
              apiKey: binance.apiKey,
              apiSecret: binance.apiSecret,
              baseUrl: 'https://api.binance.com',
              fetch: globalThis.fetch,
              clock,
            })
          : null;
      },
      inject: [APP_CONFIG, CLOCK],
    },
    { provide: EXCHANGE_SNAPSHOT_STORE, useClass: SettingExchangeSnapshotStore },
    {
      provide: WALLET_ACCOUNT_BALANCE,
      useFactory: (accounts: ListAccounts) => new FinanceWalletAccountBalance(accounts),
      inject: [ListAccounts],
    },
    {
      provide: SyncExchangeAccount,
      useFactory: (
        uow: UnitOfWorkPort,
        exchange: ExchangePort | null,
        events: IntegrationEventStore,
        store: ExchangeSnapshotStore,
        clock: ClockPort,
      ) => (exchange ? new SyncExchangeAccount(uow, exchange, events, store, clock) : null),
      inject: [UNIT_OF_WORK, EXCHANGE, INTEGRATION_EVENT_STORE, EXCHANGE_SNAPSHOT_STORE, CLOCK],
    },
    {
      provide: GetExchangeSnapshot,
      useFactory: (
        authorization: AuthorizationPort,
        mapping: IntegrationMappingPort,
        store: ExchangeSnapshotStore,
        wallet: WalletAccountBalancePort,
      ) => new GetExchangeSnapshot(authorization, mapping, store, wallet),
      inject: [AUTHORIZATION, INTEGRATION_MAPPING, EXCHANGE_SNAPSHOT_STORE, WALLET_ACCOUNT_BALANCE],
    },
  ],
  exports: [SyncExchangeAccount, GetExchangeSnapshot, EXCHANGE],
})
export class ExchangeModule {}
