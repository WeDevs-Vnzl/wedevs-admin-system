import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildExpenseWorld } from '../../../../test/finance/expenses/int-world';
import { buildPaymentWorld } from '../../../../test/finance/payments/int-world';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedProject,
} from '../../../../test/finance/read-models/world';
import { createTestPrisma, truncateBusinessTables } from '../../../../test/support/db';
import { assertLocalDatabaseUrl } from '../../../../test/support/local-db-guard';
import type { CurrentUser } from '../../../shared/application/current-user';
import type { SearchReindexSource } from '../../../shared/application/ports/search-reindex.port';
import type { EntityType } from '../../../shared/domain/enums';
import { PrismaSearchIndex } from '../../../shared/infrastructure/prisma/prisma-search-index';
import { PrismaService } from '../../../shared/infrastructure/prisma/prisma.service';
import { accountSearchEntry } from '../application/use-cases/accounts/account-support';
import {
  AccountReindexSource,
  ExpenseReindexSource,
  InvoiceReindexSource,
  PaymentReindexSource,
} from './finance-reindex-sources';
import { PrismaAccountRepository } from './prisma-account.repository';

const admin = createTestPrisma();
const service = new PrismaService({
  DATABASE_URL: assertLocalDatabaseUrl(process.env.DATABASE_URL),
});
const payments = buildPaymentWorld(service);
const expenses = buildExpenseWorld(service);
const { host, uow } = payments;
const accounts = new PrismaAccountRepository(host);

let owner: CurrentUser;
let methodId: string;
let categoryId: string;

beforeAll(() => truncateBusinessTables(admin), 60_000);
afterAll(async () => {
  await truncateBusinessTables(admin);
  await service.client.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await truncateBusinessTables(admin);
  const row = await admin.user.create({
    data: { clerkId: 'user_reindex', email: 'reindex@example.test', name: 'Owner', role: 'OWNER' },
  });
  owner = { userId: row.id, clerkId: row.clerkId, role: 'OWNER', email: row.email, name: 'Owner' };
  await uow.run(async () => {
    await seedClient(host.db, 'cli_a');
    await seedProject(host.db, 'pry_a', ['cli_a']);
    await seedAccount(host.db, 'acc_a');
    const ids = await catalogIds(host.db);
    methodId = ids.methodId;
    categoryId = ids.categoryId;
  });
}, 60_000);

const invoiceInput = (invoiceNumber: string) => ({
  clientId: 'cli_a',
  invoiceNumber,
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'USD',
  usdRate: '1',
  lines: [
    { description: 'Diseño web', projectId: 'pry_a', unitPrice: '70.00', ivaRate: null },
    { description: 'Hosting anual', projectId: 'pry_a', unitPrice: '30.00', ivaRate: null },
  ],
});

/** The row the mutation left in `SearchEntry`, shaped like a `SearchIndexEntry`. */
async function stored(entityType: EntityType, entityId: string) {
  const row = await admin.searchEntry.findUniqueOrThrow({
    where: { entityType_entityId: { entityType, entityId } },
  });
  return {
    entityType,
    entityId,
    code: row.code,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    status: row.status,
    archived: row.archived,
  };
}

describe('the finance reindex sources rebuild what the mutations wrote', () => {
  it('INVOICE: the source entry equals the one the create left, archived invoices included', async () => {
    const invoice = await payments.create.execute(owner, invoiceInput('N-1') as never);
    const source = new InvoiceReindexSource(host, payments.invoices);

    expect(await source.entryOf(invoice.id)).toEqual(await stored('INVOICE', invoice.id));
    expect((await source.entryOf(invoice.id))?.subtitle).toBeTruthy();

    await payments.archive.execute(owner, { id: invoice.id });
    expect(await source.entryOf(invoice.id)).toEqual(await stored('INVOICE', invoice.id));
    expect((await source.entryOf(invoice.id))?.archived).toBe(true);
    expect(await source.pageIds(null, 10)).toEqual([invoice.id]);
  });

  it('PAYMENT: the source entry equals the one the create left, with the method name in the body', async () => {
    const payment = await payments.createPayment.execute(owner, {
      clientId: 'cli_a',
      date: '2026-10-05',
      accountId: 'acc_a',
      methodId,
      currency: 'USD',
      amount: '80.00',
      usdRate: '1',
      reference: 'REF-77',
    } as never);
    const source = new PaymentReindexSource(host, payments.payments);

    expect(await source.entryOf(payment.id)).toEqual(await stored('PAYMENT', payment.id));
    expect((await source.entryOf(payment.id))?.body).toContain('REF-77');
    expect(await source.pageIds(null, 10)).toEqual([payment.id]);
  });

  it('EXPENSE: the source entry equals the one the create left', async () => {
    const expense = await expenses.createExpense.execute(owner, {
      date: '2026-10-05',
      description: 'Dominio',
      vendor: 'Registrar SA',
      categoryId,
      currency: 'USD',
      amount: '10.00',
      usdRate: '1',
      status: 'PENDIENTE',
    } as never);
    const source = new ExpenseReindexSource(host, expenses.expenses);

    expect(await source.entryOf(expense.id)).toEqual(await stored('EXPENSE', expense.id));
    expect(await source.pageIds(null, 10)).toEqual([expense.id]);
  });

  it('ACCOUNT: the entry follows the account builder and an archived account keeps it with archived true', async () => {
    const source = new AccountReindexSource(host);
    const found = await accounts.find('acc_a');
    expect(found).not.toBeNull();
    await uow.run(() =>
      new PrismaSearchIndex(host).upsert(accountSearchEntry(found as NonNullable<typeof found>)),
    );

    expect(await source.entryOf('acc_a')).toEqual(await stored('ACCOUNT', 'acc_a'));

    await admin.account.update({ where: { id: 'acc_a' }, data: { deletedAt: new Date() } });
    expect(await source.entryOf('acc_a')).toMatchObject({ entityId: 'acc_a', archived: true });
    expect(await source.pageIds(null, 10)).toEqual(['acc_a']);
  });

  it('answers null for a missing source row', async () => {
    for (const source of [
      new InvoiceReindexSource(host, payments.invoices),
      new PaymentReindexSource(host, payments.payments),
      new ExpenseReindexSource(host, expenses.expenses),
      new AccountReindexSource(host),
    ] satisfies SearchReindexSource[]) {
      expect(await source.entryOf('missing')).toBeNull();
    }
  });

  it('pages ids ascending after the cursor', async () => {
    const created: string[] = [];
    for (const number of ['N-1', 'N-2', 'N-3']) {
      created.push((await payments.create.execute(owner, invoiceInput(number) as never)).id);
    }
    const sorted = [...created].sort();
    const source = new InvoiceReindexSource(host, payments.invoices);

    expect(await source.pageIds(null, 2)).toEqual(sorted.slice(0, 2));
    expect(await source.pageIds(sorted[1] as string, 2)).toEqual(sorted.slice(2));
    expect(await source.pageIds(sorted[2] as string, 2)).toEqual([]);
  });
});
