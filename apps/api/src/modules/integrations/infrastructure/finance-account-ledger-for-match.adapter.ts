import { Injectable } from '@nestjs/common';
import type { GetAccountLedger } from '../../finance/application/use-cases/accounts/get-account-ledger.use-case';
import type { CurrentUser } from '../../../shared/application/current-user';
import { DEFAULT_LIST_QUERY } from '../../../shared/domain/list-query';
import type { AccountLedgerForMatchPort } from '../application/ports/account-ledger-for-match.port';
import type { LedgerRecord, LedgerRecordKind } from '../domain/statement-matching';

/** Resolves the caller the ledger read runs as: the actor of the import in progress (wired with the module). */
export type LedgerActorSource = () => CurrentUser;

const PAGE_SIZE = 100;

/** Finance ledger kinds that are not a bank operation (the opening balance) map to `null` and are skipped. */
const KIND_OF: Readonly<Record<string, LedgerRecordKind | null>> = {
  OPENING_BALANCE: null,
  PAYMENT: 'PAYMENT',
  EXPENSE: 'EXPENSE',
  TRANSFER_OUT: 'TRANSFER',
  TRANSFER_IN: 'TRANSFER',
  APORTE_CAPITAL: 'MOVEMENT',
  RETIRO_SOCIO: 'MOVEMENT',
  AJUSTE: 'MOVEMENT',
};

/**
 * `AccountLedgerForMatchPort` over finance's exported `GetAccountLedger` (DT-110): every page of the account's
 * ledger in the window, mapped to the matching rule's records. The read runs under `can(read, account)` as the
 * actor the source returns. Finance's ledger carries no external reference, so `reference` is `null` and
 * matching falls back to amount and date.
 */
@Injectable()
export class FinanceAccountLedgerForMatch implements AccountLedgerForMatchPort {
  constructor(
    private readonly ledger: Pick<GetAccountLedger, 'execute'>,
    private readonly actor: LedgerActorSource,
  ) {}

  async entries(accountId: string, from: string, to: string): Promise<LedgerRecord[]> {
    const records: LedgerRecord[] = [];
    for (let page = 1; ; page += 1) {
      const result = await this.ledger.execute(this.actor(), accountId, {
        ...DEFAULT_LIST_QUERY,
        page,
        pageSize: PAGE_SIZE,
        filters: { dateFrom: from, dateTo: to },
      });
      for (const row of result.items) {
        const kind = KIND_OF[row.kind] ?? null;
        if (kind === null) continue;
        records.push({ id: row.id, kind, date: row.date, amount: row.amount, reference: null });
      }
      if (page >= result.pageCount) return records;
    }
  }
}
