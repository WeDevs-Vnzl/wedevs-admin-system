import type {
  AccountFilter,
  AccountPatch,
  AccountRecord,
  AccountRepository,
  LedgerEntryKind,
  LedgerFilter,
  LedgerRow,
  MovementRecord,
  NewAccount,
  ReconciliationRecord,
  TransferRecord,
} from '../../../../src/modules/finance/application/ports/account.repository.port';
import {
  accountLedger,
  type AccountActivity,
  type LedgerKind,
} from '../../../../src/modules/finance/domain/accounts';
import type { DateOnly } from '../../../../src/shared/domain/business-date';
import { roundMoney, type MoneyString } from '../../../../src/shared/domain/money';
import { paginated, type Paginated } from '../../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../../support/fakes/in-memory-unit-of-work';

const LEDGER_END: DateOnly = '9999-12-31';

/** A payment or expense that points at an account, the way the later slices will write them. */
export interface ExternalEntry {
  readonly id: string;
  readonly accountId: string;
  readonly date: DateOnly;
  readonly amount: MoneyString;
  readonly kind: 'PAYMENT' | 'EXPENSE';
  readonly code: string;
}

interface State {
  accounts: Map<string, AccountRecord>;
  transfers: TransferRecord[];
  movements: MovementRecord[];
  reconciliations: ReconciliationRecord[];
  external: ExternalEntry[];
}

const clone = (state: State): State => ({
  accounts: new Map(state.accounts),
  transfers: [...state.transfers],
  movements: [...state.movements],
  reconciliations: [...state.reconciliations],
  external: [...state.external],
});

const byDate = <T extends { date: DateOnly }>(a: T, b: T) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** Fake `AccountRepository`: rolls back with the unit of work, ledger built from the domain calculator. */
export class InMemoryAccountRepository implements AccountRepository, TransactionParticipant {
  private state: State = {
    accounts: new Map(),
    transfers: [],
    movements: [],
    reconciliations: [],
    external: [],
  };
  private snapshot: State | undefined;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  get accounts(): AccountRecord[] {
    return [...this.state.accounts.values()];
  }
  get transfers(): readonly TransferRecord[] {
    return this.state.transfers;
  }
  get movements(): readonly MovementRecord[] {
    return this.state.movements;
  }
  get reconciliations(): readonly ReconciliationRecord[] {
    return this.state.reconciliations;
  }

  /** Test seam: an entry of a slice that does not exist yet (payments, expenses). */
  addExternal(entry: ExternalEntry): void {
    this.state.external.push(entry);
  }

  /** What `FinanceSourcesPort.accountSource` would read. */
  activityOf(id: string): AccountActivity | null {
    const account = this.state.accounts.get(id);
    if (!account) return null;
    return {
      openingBalance: account.openingBalance,
      payments: this.state.external
        .filter((e) => e.accountId === id && e.kind === 'PAYMENT')
        .map((e) => ({ date: e.date, netCredited: e.amount, status: 'CONFIRMADO' as const })),
      expenses: this.state.external
        .filter((e) => e.accountId === id && e.kind === 'EXPENSE')
        .map((e) => ({
          date: e.date,
          amount: e.amount,
          accountAmount: null,
          status: 'PAGADO' as const,
        })),
      transfersIn: this.state.transfers
        .filter((t) => t.toAccountId === id)
        .map((t) => ({ date: t.date, amountTo: t.amountTo })),
      transfersOut: this.state.transfers
        .filter((t) => t.fromAccountId === id)
        .map((t) => ({ date: t.date, amountFrom: t.amountFrom, feeAmount: t.feeAmount })),
      movements: this.state.movements
        .filter((m) => m.accountId === id)
        .map((m) => ({ date: m.date, type: m.type, amount: m.amount })),
    };
  }

  setBalance(id: string, balance: MoneyString): void {
    this.uow.assertActive('InMemoryAccountRepository.setBalance');
    const account = this.state.accounts.get(id);
    if (account) this.state.accounts.set(id, { ...account, balance });
  }

  async find(id: string): Promise<AccountRecord | null> {
    return this.state.accounts.get(id) ?? null;
  }

  async list(filter: AccountFilter): Promise<Paginated<AccountRecord>> {
    const statuses = filter.statuses?.length ? filter.statuses : undefined;
    const fields: Record<string, (a: AccountRecord) => string | number | boolean> = {
      name: (a) => a.name,
      type: (a) => a.type,
      institution: (a) => a.institution ?? '',
      currency: (a) => a.currency,
      balance: (a) => Number(a.balance),
      status: (a) => a.active,
    };
    const key = fields[filter.sort.field] ?? ((a: AccountRecord) => a.name);
    const rows = this.accounts
      .filter((a) =>
        statuses
          ? statuses.includes(a.active ? 'active' : 'inactive')
          : filter.includeInactive || a.active,
      )
      .filter((a) => !filter.types?.length || filter.types.includes(a.type))
      .filter((a) => !filter.currencies?.length || filter.currencies.includes(a.currency))
      .filter((a) => !filter.q || a.name.toLowerCase().includes(filter.q.toLowerCase()))
      .sort((a, b) => {
        const [x, y] = [key(a), key(b)];
        const order = x < y ? -1 : x > y ? 1 : 0;
        return filter.sort.direction === 'desc' ? -order : order;
      });
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(rows.slice(start, start + filter.pageSize), rows.length, filter);
  }

  async insert(account: NewAccount): Promise<void> {
    this.uow.assertActive('AccountRepository.insert');
    this.state.accounts.set(account.id, { ...account, balance: '0.00' });
  }

  async update(id: string, patch: AccountPatch): Promise<void> {
    this.uow.assertActive('AccountRepository.update');
    const account = this.state.accounts.get(id);
    if (!account) throw new Error(`no account ${id}`);
    this.state.accounts.set(id, { ...account, ...patch });
  }

  async hasMovements(id: string): Promise<boolean> {
    return (
      this.state.external.some((e) => e.accountId === id) ||
      this.state.transfers.some((t) => t.fromAccountId === id || t.toAccountId === id) ||
      this.state.movements.some((m) => m.accountId === id)
    );
  }

  async insertTransfer(transfer: TransferRecord): Promise<void> {
    this.uow.assertActive('AccountRepository.insertTransfer');
    this.state.transfers.push(transfer);
  }

  async insertMovement(movement: MovementRecord): Promise<void> {
    this.uow.assertActive('AccountRepository.insertMovement');
    this.state.movements.push(movement);
  }

  async insertReconciliation(reconciliation: ReconciliationRecord): Promise<void> {
    this.uow.assertActive('AccountRepository.insertReconciliation');
    this.state.reconciliations.push(reconciliation);
  }

  async ledger(filter: LedgerFilter): Promise<Paginated<LedgerRow>> {
    const account = this.state.accounts.get(filter.accountId);
    if (!account) return paginated([], 0, filter);
    const activity = this.activityOf(filter.accountId) as AccountActivity;
    const sources: Record<LedgerKind, { id: string; date: DateOnly; kind: LedgerEntryKind }[]> = {
      PAYMENT: this.state.external
        .filter((e) => e.accountId === account.id && e.kind === 'PAYMENT')
        .map((e) => ({ id: e.id, date: e.date, kind: 'PAYMENT' as const })),
      EXPENSE: this.state.external
        .filter((e) => e.accountId === account.id && e.kind === 'EXPENSE')
        .map((e) => ({ id: e.id, date: e.date, kind: 'EXPENSE' as const })),
      TRANSFER_IN: this.state.transfers
        .filter((t) => t.toAccountId === account.id)
        .map((t) => ({ id: t.id, date: t.date, kind: 'TRANSFER_IN' as const })),
      TRANSFER_OUT: this.state.transfers
        .filter((t) => t.fromAccountId === account.id)
        .map((t) => ({ id: t.id, date: t.date, kind: 'TRANSFER_OUT' as const })),
      MOVEMENT: this.state.movements
        .filter((m) => m.accountId === account.id)
        .map((m) => ({ id: m.id, date: m.date, kind: m.type })),
    };
    for (const queue of Object.values(sources)) queue.sort(byDate);
    const cursor: Record<LedgerKind, number> = {
      PAYMENT: 0,
      EXPENSE: 0,
      TRANSFER_IN: 0,
      TRANSFER_OUT: 0,
      MOVEMENT: 0,
    };
    const rows: LedgerRow[] = [
      {
        id: `opening:${account.id}`,
        date: account.openingDate,
        kind: 'OPENING_BALANCE',
        source: null,
        description: null,
        amount: roundMoney(account.openingBalance),
        balance: roundMoney(account.openingBalance),
      },
    ];
    for (const entry of accountLedger(activity, LEDGER_END)) {
      const source = sources[entry.kind][cursor[entry.kind]++];
      if (!source) throw new Error('ledger does not match its sources');
      rows.push({
        id: source.id,
        date: entry.date,
        kind: source.kind,
        source: null,
        description: null,
        amount: entry.delta,
        balance: entry.balance,
      });
    }
    const kept = rows
      .filter((row) => !filter.kinds?.length || filter.kinds.includes(row.kind))
      .filter((row) => !filter.dateFrom || row.date >= filter.dateFrom)
      .filter((row) => !filter.dateTo || row.date <= filter.dateTo);
    const field = filter.sort.field as 'date' | 'kind' | 'amount' | 'balance';
    kept.sort((a, b) => {
      const [x, y] =
        field === 'amount' || field === 'balance'
          ? [Number(a[field]), Number(b[field])]
          : [a[field], b[field]];
      const order = x < y ? -1 : x > y ? 1 : 0;
      return filter.sort.direction === 'desc' ? -order : order;
    });
    const start = (filter.page - 1) * filter.pageSize;
    return paginated(kept.slice(start, start + filter.pageSize), kept.length, filter);
  }

  begin(): void {
    this.snapshot = clone(this.state);
  }

  commit(): void {
    this.snapshot = undefined;
  }

  rollback(): void {
    if (this.snapshot) this.state = this.snapshot;
    this.snapshot = undefined;
  }
}
