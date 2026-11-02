import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '../../../shared/infrastructure/prisma/generated-client';
import { paginated, pageWindow, type Paginated } from '../../../shared/domain/pagination';
import { roundMoney } from '../../../shared/domain/money';
import {
  dateOnlyToDbDate,
  dbDateToDateOnly,
  decimalToString,
  stringToDecimal,
} from '../../../shared/infrastructure/prisma/decimal-mapper';
import { escapeLike, listPage } from '../../../shared/infrastructure/prisma/prisma-list';
import { TransactionHost } from '../../../shared/infrastructure/prisma/transaction-host';
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
} from '../application/ports/account.repository.port';

const money = (value: Prisma.Decimal) => roundMoney(decimalToString(value));

/** An explicit `deletedAt` key opts out of the soft-delete default filter (archived rows included). */
const INCLUDING_ARCHIVED = { deletedAt: undefined } as const;

/** API sort field -> SQL expression over the ledger CTE (a closed whitelist, never caller text). */
const LEDGER_SORT: Record<string, string> = {
  date: '"date"',
  kind: '"kind"',
  amount: '"amount"',
  balance: '"balance"',
};

interface RawLedgerRow {
  sourceId: string;
  date: Date;
  kind: string;
  amount: Prisma.Decimal;
  balance: Prisma.Decimal;
  paymentCode: string | null;
  paymentReference: string | null;
  expenseCode: string | null;
  expenseDescription: string | null;
  transferReference: string | null;
  transferNotes: string | null;
  movementDescription: string | null;
}

/**
 * Accounts, transfers, movements and reconciliations through the current transaction (or the base client
 * outside a unit of work). The ledger is raw SQL over `account_ledger_v` (DT-105/106) joined to the finance
 * tables that give each entry its identity; no other context's table is read. Takes no lock: the use case
 * holds the `Account` rows (global lock order).
 */
@Injectable()
export class PrismaAccountRepository implements AccountRepository {
  constructor(@Inject(TransactionHost) private readonly host: TransactionHost) {}

  private get db() {
    return this.host.db;
  }

  async find(id: string): Promise<AccountRecord | null> {
    const row = await this.db.account.findUnique({ where: { id } });
    return row && row.deletedAt === null ? toRecord(row) : null;
  }

  async list(filter: AccountFilter): Promise<Paginated<AccountRecord>> {
    const statuses = filter.statuses?.length ? filter.statuses : undefined;
    const wanted = statuses
      ? [...new Set(statuses.map((status) => status === 'active'))]
      : filter.includeInactive
        ? [true, false]
        : [true];
    // Both values mean no filter on `active`.
    const active = wanted.length === 1 ? wanted[0] : undefined;
    const where: Record<string, unknown> = {
      ...(filter.types?.length ? { type: { in: [...filter.types] } } : {}),
      ...(filter.currencies?.length ? { currency: { in: [...filter.currencies] } } : {}),
      ...(active !== undefined ? { active } : {}),
    };
    const conditions: Prisma.Sql[] = [];
    if (filter.types?.length) conditions.push(Prisma.sql`"type"::text = ANY(${[...filter.types]})`);
    if (filter.currencies?.length) {
      conditions.push(Prisma.sql`"currency" = ANY(${[...filter.currencies]})`);
    }
    if (active !== undefined) conditions.push(Prisma.sql`"active" = ${active}`);
    const page = await listPage(this.db, {
      table: 'Account',
      searchEntryType: 'ACCOUNT',
      sortMap: {
        name: 'name',
        type: 'type',
        institution: { path: 'institution', nullable: true },
        currency: 'currency',
        balance: 'balance',
        status: 'active',
      },
      defaultSort: { field: 'name', direction: 'asc' },
      where,
      sqlWhere: conditions.length > 0 ? Prisma.join(conditions, ' AND ') : Prisma.sql`TRUE`,
      query: {
        page: filter.page,
        pageSize: filter.pageSize as 25 | 50 | 100,
        sort: filter.sort,
        archived: 'exclude',
        filters: {},
        ...(filter.q ? { q: filter.q } : {}),
      },
      find: (args) => this.db.account.findMany(args),
      count: (args) => this.db.account.count(args),
    });
    return { ...page, items: page.items.map(toRecord) };
  }

  async insert(account: NewAccount): Promise<void> {
    await this.db.account.create({
      data: {
        id: account.id,
        name: account.name,
        type: account.type,
        institution: account.institution,
        currency: account.currency,
        identifierMasked: account.identifierMasked,
        holderName: account.holderName,
        openingBalance: stringToDecimal(account.openingBalance),
        openingDate: dateOnlyToDbDate(account.openingDate),
        active: account.active,
        notes: account.notes,
        createdAt: new Date(account.createdAt),
        updatedAt: new Date(account.updatedAt),
      },
    });
  }

  async update(id: string, patch: AccountPatch): Promise<void> {
    await this.db.account.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.institution !== undefined ? { institution: patch.institution } : {}),
        ...(patch.currency !== undefined ? { currency: patch.currency } : {}),
        ...(patch.identifierMasked !== undefined
          ? { identifierMasked: patch.identifierMasked }
          : {}),
        ...(patch.holderName !== undefined ? { holderName: patch.holderName } : {}),
        ...(patch.openingBalance !== undefined
          ? { openingBalance: stringToDecimal(patch.openingBalance) }
          : {}),
        ...(patch.openingDate !== undefined
          ? { openingDate: dateOnlyToDbDate(patch.openingDate) }
          : {}),
        ...(patch.active !== undefined ? { active: patch.active } : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        updatedAt: new Date(patch.updatedAt),
      },
    });
  }

  async hasMovements(id: string): Promise<boolean> {
    const payment = await this.db.payment.findFirst({
      where: { accountId: id, ...INCLUDING_ARCHIVED },
      select: { id: true },
    });
    if (payment) return true;
    const expense = await this.db.expense.findFirst({
      where: { accountId: id, ...INCLUDING_ARCHIVED },
      select: { id: true },
    });
    if (expense) return true;
    const transfer = await this.db.accountTransfer.findFirst({
      where: { OR: [{ fromAccountId: id }, { toAccountId: id }], ...INCLUDING_ARCHIVED },
      select: { id: true },
    });
    if (transfer) return true;
    const movement = await this.db.accountMovement.findFirst({
      where: { accountId: id, ...INCLUDING_ARCHIVED },
      select: { id: true },
    });
    return movement !== null;
  }

  async insertTransfer(transfer: TransferRecord): Promise<void> {
    await this.db.accountTransfer.create({
      data: {
        id: transfer.id,
        date: dateOnlyToDbDate(transfer.date),
        fromAccountId: transfer.fromAccountId,
        toAccountId: transfer.toAccountId,
        amountFrom: stringToDecimal(transfer.amountFrom),
        amountTo: stringToDecimal(transfer.amountTo),
        feeAmount: stringToDecimal(transfer.feeAmount),
        rate: transfer.rate === null ? null : stringToDecimal(transfer.rate),
        amountUsd: stringToDecimal(transfer.amountUsd),
        reference: transfer.reference,
        notes: transfer.notes,
        createdAt: new Date(transfer.createdAt),
        createdById: transfer.createdById,
      },
    });
  }

  async insertMovement(movement: MovementRecord): Promise<void> {
    await this.db.accountMovement.create({
      data: {
        id: movement.id,
        accountId: movement.accountId,
        type: movement.type,
        date: dateOnlyToDbDate(movement.date),
        amount: stringToDecimal(movement.amount),
        amountUsd: stringToDecimal(movement.amountUsd),
        partnerId: movement.partnerId,
        description: movement.description,
        createdAt: new Date(movement.createdAt),
        createdById: movement.createdById,
      },
    });
  }

  async insertReconciliation(reconciliation: ReconciliationRecord): Promise<void> {
    await this.db.accountReconciliation.create({
      data: {
        id: reconciliation.id,
        accountId: reconciliation.accountId,
        date: dateOnlyToDbDate(reconciliation.date),
        statementBalance: stringToDecimal(reconciliation.statementBalance),
        systemBalance: stringToDecimal(reconciliation.systemBalance),
        difference: stringToDecimal(reconciliation.difference),
        notes: reconciliation.notes,
        createdAt: new Date(reconciliation.createdAt),
        createdById: reconciliation.createdById,
      },
    });
  }

  async ledger(filter: LedgerFilter): Promise<Paginated<LedgerRow>> {
    const conditions: Prisma.Sql[] = [];
    if (filter.kinds?.length) conditions.push(Prisma.sql`"kind" = ANY(${[...filter.kinds]})`);
    if (filter.dateFrom)
      conditions.push(Prisma.sql`"date" >= ${dateOnlyToDbDate(filter.dateFrom)}::date`);
    if (filter.dateTo)
      conditions.push(Prisma.sql`"date" <= ${dateOnlyToDbDate(filter.dateTo)}::date`);
    const text = filter.q?.trim();
    if (text) {
      const pattern = escapeLike(text);
      conditions.push(
        Prisma.sql`unaccent(lower(concat_ws(' ', "paymentCode", "paymentReference", "expenseCode", "expenseDescription", "transferReference", "transferNotes", "movementDescription"))) LIKE '%' || unaccent(lower(${pattern})) || '%' ESCAPE '\\'`,
      );
    }
    const where =
      conditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}` : Prisma.empty;
    const column = Prisma.raw(LEDGER_SORT[filter.sort.field] ?? '"date"');
    const direction = Prisma.raw(filter.sort.direction === 'desc' ? 'DESC' : 'ASC');
    const { skip, take } = pageWindow(filter.page, filter.pageSize);
    // The window runs over every entry of the account, so filtering afterwards never changes a balance.
    const entries = Prisma.sql`
      WITH ledger AS (
        SELECT v."sourceId", v."date", v.amount, v.balance, v.seq, v."createdAt",
          CASE v.kind WHEN 'OPENING' THEN 'OPENING_BALANCE'
                      WHEN 'MOVEMENT' THEN m."type"::text ELSE v.kind END AS "kind",
          p."code" AS "paymentCode", p."reference" AS "paymentReference",
          e."code" AS "expenseCode", e."description" AS "expenseDescription",
          t."reference" AS "transferReference", t."notes" AS "transferNotes",
          m."description" AS "movementDescription"
        FROM account_ledger_v v
        LEFT JOIN "Payment" p ON v.kind = 'PAYMENT' AND p."id" = v."sourceId"
        LEFT JOIN "Expense" e ON v.kind = 'EXPENSE' AND e."id" = v."sourceId"
        LEFT JOIN "AccountTransfer" t ON v.kind IN ('TRANSFER_OUT', 'TRANSFER_IN') AND t."id" = v."sourceId"
        LEFT JOIN "AccountMovement" m ON v.kind = 'MOVEMENT' AND m."id" = v."sourceId"
        WHERE v."accountId" = ${filter.accountId}
      )`;
    const rows = await this.db.$queryRaw<RawLedgerRow[]>(Prisma.sql`
      ${entries}
      SELECT * FROM ledger ${where}
      ORDER BY ${column} ${direction}, seq ASC, "createdAt" ASC, "sourceId" ASC
      LIMIT ${take} OFFSET ${skip}`);
    const counted = await this.db.$queryRaw<{ total: number }[]>(Prisma.sql`
      ${entries}
      SELECT count(*)::int AS "total" FROM ledger ${where}`);
    return paginated(
      rows.map((row) => toLedgerRow(row, filter.accountId)),
      counted[0]?.total ?? 0,
      filter,
    );
  }
}

function toLedgerRow(row: RawLedgerRow, accountId: string): LedgerRow {
  const kind = row.kind as LedgerEntryKind | 'TRANSFER_IN' | 'TRANSFER_OUT';
  const base = {
    date: dbDateToDateOnly(row.date),
    kind,
    amount: money(row.amount),
    balance: money(row.balance),
  };
  if (kind === 'OPENING_BALANCE') {
    return { ...base, id: `opening:${accountId}`, source: null, description: null };
  }
  const id = row.sourceId;
  if (kind === 'PAYMENT') {
    return {
      ...base,
      id,
      source: { type: 'PAYMENT', id, label: row.paymentCode ?? id },
      description: row.paymentReference,
    };
  }
  if (kind === 'EXPENSE') {
    return {
      ...base,
      id,
      source: { type: 'EXPENSE', id, label: row.expenseCode ?? id },
      description: row.expenseDescription,
    };
  }
  if (kind === 'TRANSFER_IN' || kind === 'TRANSFER_OUT') {
    return {
      ...base,
      id,
      source: { type: 'TRANSFER', id, label: row.transferReference ?? id },
      description: row.transferNotes,
    };
  }
  return {
    ...base,
    id,
    source: { type: 'ACCOUNT_MOVEMENT', id, label: row.movementDescription ?? id },
    description: row.movementDescription,
  };
}

export function toRecord(row: {
  id: string;
  name: string;
  type: AccountRecord['type'];
  institution: string | null;
  currency: string;
  identifierMasked: string | null;
  holderName: string | null;
  openingBalance: Prisma.Decimal;
  openingDate: Date;
  active: boolean;
  notes: string | null;
  balance: Prisma.Decimal;
  createdAt: Date;
  updatedAt: Date;
}): AccountRecord {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    institution: row.institution,
    currency: row.currency,
    identifierMasked: row.identifierMasked,
    holderName: row.holderName,
    openingBalance: money(row.openingBalance),
    openingDate: dbDateToDateOnly(row.openingDate),
    active: row.active,
    notes: row.notes,
    balance: money(row.balance),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
