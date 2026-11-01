import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import {
  expectViolation,
  makeAccount,
  makeClient,
  makeContact,
  makeDocument,
  makeExpense,
  makeInvoice,
  makeNote,
  makePayment,
  makeProject,
  makeTag,
  makeUser,
  uid,
} from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await truncateBusinessTables(prisma);
  // Catalogs are required by these tests (seeded by `db:reset`); fail fast with a clear message.
  const seeded = await prisma.currency.count();
  if (seeded === 0) throw new Error('Database is not seeded: run `bun run db:reset` first');
});

beforeEach(async () => {
  await truncateBusinessTables(prisma);
});

afterAll(async () => {
  await truncateBusinessTables(prisma);
  await prisma.$disconnect();
});

describe('polymorphic link CHECKs (exactly one target)', () => {
  it('doclink_one_target: 1 target accepted, 0 and 2 rejected', async () => {
    const doc = await makeDocument(prisma);
    const client = await makeClient(prisma);
    const project = await makeProject(prisma);
    await expect(
      prisma.documentLink.create({ data: { documentId: doc.id, clientId: client.id } }),
    ).resolves.toBeTruthy();
    await expectViolation(
      prisma.documentLink.create({ data: { documentId: doc.id } }),
      'doclink_one_target',
    );
    await expectViolation(
      prisma.documentLink.create({
        data: { documentId: doc.id, clientId: client.id, projectId: project.id },
      }),
      'doclink_one_target',
    );
  });

  it('notelink_one_target: 1 target accepted, 0 and 2 rejected', async () => {
    const note = await makeNote(prisma);
    const client = await makeClient(prisma);
    const project = await makeProject(prisma);
    await expect(
      prisma.noteLink.create({ data: { noteId: note.id, clientId: client.id } }),
    ).resolves.toBeTruthy();
    await expectViolation(
      prisma.noteLink.create({ data: { noteId: note.id } }),
      'notelink_one_target',
    );
    await expectViolation(
      prisma.noteLink.create({
        data: { noteId: note.id, clientId: client.id, projectId: project.id },
      }),
      'notelink_one_target',
    );
  });

  it('tag_one_target: 1 target accepted, 0 and 2 rejected', async () => {
    const tag = await makeTag(prisma);
    const client = await makeClient(prisma);
    const project = await makeProject(prisma);
    await expect(
      prisma.tagAssignment.create({ data: { tagId: tag.id, clientId: client.id } }),
    ).resolves.toBeTruthy();
    await expectViolation(
      prisma.tagAssignment.create({ data: { tagId: tag.id } }),
      'tag_one_target',
    );
    await expectViolation(
      prisma.tagAssignment.create({
        data: { tagId: tag.id, clientId: client.id, projectId: project.id },
      }),
      'tag_one_target',
    );
  });
});

describe('partial uniques that respect soft delete', () => {
  it('client_taxid_country_active', async () => {
    const first = await makeClient(prisma, { taxId: 'J-1', country: 'VE' });
    await expect(makeClient(prisma, { taxId: 'J-1', country: 'CO' })).resolves.toBeTruthy(); // other country
    await expectViolation(
      makeClient(prisma, { taxId: 'J-1', country: 'VE' }),
      'client_taxid_country_active',
    );
    await prisma.client.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(makeClient(prisma, { taxId: 'J-1', country: 'VE' })).resolves.toBeTruthy(); // archived row ignored
  });

  it('invoice_number_active', async () => {
    const client = await makeClient(prisma);
    const first = await makeInvoice(prisma, client.id, { invoiceNumber: 'N-1' });
    await expectViolation(
      makeInvoice(prisma, client.id, { invoiceNumber: 'N-1' }),
      'invoice_number_active',
    );
    await prisma.invoice.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(makeInvoice(prisma, client.id, { invoiceNumber: 'N-1' })).resolves.toBeTruthy();
  });

  it('allocation_unique_active', async () => {
    const client = await makeClient(prisma);
    const account = await makeAccount(prisma);
    const invoice = await makeInvoice(prisma, client.id);
    const payment = await makePayment(prisma, client.id, account.id);
    const data = {
      paymentId: payment.id,
      invoiceId: invoice.id,
      amountPaymentCurrency: '10',
      amountInvoiceCurrency: '10',
      amountUsd: '10',
    };
    const first = await prisma.paymentAllocation.create({ data });
    await expectViolation(prisma.paymentAllocation.create({ data }), 'allocation_unique_active');
    await prisma.paymentAllocation.update({
      where: { id: first.id },
      data: { deletedAt: new Date() },
    });
    await expect(prisma.paymentAllocation.create({ data })).resolves.toBeTruthy();
  });

  it('contact_one_primary', async () => {
    const client = await makeClient(prisma);
    const first = await makeContact(prisma, client.id, true);
    await expect(makeContact(prisma, client.id, false)).resolves.toBeTruthy(); // non-primary is free
    await expectViolation(makeContact(prisma, client.id, true), 'contact_one_primary');
    await prisma.contact.update({ where: { id: first.id }, data: { deletedAt: new Date() } });
    await expect(makeContact(prisma, client.id, true)).resolves.toBeTruthy();
  });
});

describe('integrity CHECKs', () => {
  it('rc_billing_day: 0 and 29 rejected, 1 and 28 accepted', async () => {
    const project = await makeProject(prisma);
    const make = (billingDay: number) =>
      prisma.recurringCharge.create({
        data: {
          projectId: project.id,
          label: 'Hosting',
          amount: '10',
          currency: 'USD',
          frequency: 'MENSUAL',
          startDate: new Date('2026-01-01'),
          billingDay,
          usdRate: '1',
          monthlyAmountUsd: '10',
        },
      });
    await expectViolation(make(0), 'rc_billing_day');
    await expectViolation(make(29), 'rc_billing_day');
    await expect(make(1)).resolves.toBeTruthy();
    await expect(make(28)).resolves.toBeTruthy();
  });

  it('re_day: 0 and 29 rejected, 1 and 28 accepted', async () => {
    const make = (dayOfPeriod: number) =>
      prisma.recurringExpense.create({
        data: {
          name: uid('re'),
          categoryId: 'ecat_hosting',
          currency: 'USD',
          amount: '10',
          frequency: 'MENSUAL',
          dayOfPeriod,
          startDate: new Date('2026-01-01'),
          usdRate: '1',
          monthlyAmountUsd: '10',
        },
      });
    await expectViolation(make(0), 're_day');
    await expectViolation(make(29), 're_day');
    await expect(make(1)).resolves.toBeTruthy();
    await expect(make(28)).resolves.toBeTruthy();
  });

  it('tr_diff_account: same account rejected, different accepted', async () => {
    const a = await makeAccount(prisma);
    const b = await makeAccount(prisma);
    const make = (from: string, to: string) =>
      prisma.accountTransfer.create({
        data: {
          date: new Date('2026-01-15'),
          fromAccountId: from,
          toAccountId: to,
          amountFrom: '10',
          amountTo: '10',
          amountUsd: '10',
        },
      });
    await expectViolation(make(a.id, a.id), 'tr_diff_account');
    await expect(make(a.id, b.id)).resolves.toBeTruthy();
  });

  it('pay_amounts: non-positive amount and negative igtf/fee rejected', async () => {
    const client = await makeClient(prisma);
    const account = await makeAccount(prisma);
    await expectViolation(
      makePayment(prisma, client.id, account.id, { amount: '0' }),
      'pay_amounts',
    );
    await expectViolation(
      makePayment(prisma, client.id, account.id, { igtfAmount: '-0.01' }),
      'pay_amounts',
    );
    await expectViolation(
      makePayment(prisma, client.id, account.id, { feeAmount: '-1' }),
      'pay_amounts',
    );
    await expect(
      makePayment(prisma, client.id, account.id, {
        amount: '10',
        igtfAmount: '0.30',
        feeAmount: '0',
      }),
    ).resolves.toBeTruthy();
  });
});

describe('Δ1 multi-rate invoice CHECKs', () => {
  const line = (
    invoiceId: string,
    data: { amount: string; discount?: string; ivaRate?: string | null },
  ) =>
    prisma.invoiceLine.create({
      data: {
        invoiceId,
        description: 'Service',
        unitPrice: data.amount,
        amount: data.amount,
        discount: data.discount ?? '0',
        netAmount: data.amount,
        ivaRate: data.ivaRate === undefined ? '16' : data.ivaRate,
      },
    });

  it('invline_discount: 0 ≤ discount ≤ amount', async () => {
    const invoice = await makeInvoice(prisma, (await makeClient(prisma)).id);
    await expect(line(invoice.id, { amount: '100', discount: '100' })).resolves.toBeTruthy();
    await expectViolation(
      line(invoice.id, { amount: '100', discount: '100.01' }),
      'invline_discount',
    );
    await expectViolation(line(invoice.id, { amount: '100', discount: '-1' }), 'invline_discount');
  });

  it('invline_rate: 101 rejected, null accepted, 0 and 100 accepted', async () => {
    const invoice = await makeInvoice(prisma, (await makeClient(prisma)).id);
    await expectViolation(line(invoice.id, { amount: '10', ivaRate: '101' }), 'invline_rate');
    await expect(line(invoice.id, { amount: '10', ivaRate: null })).resolves.toBeTruthy();
    await expect(line(invoice.id, { amount: '10', ivaRate: '0' })).resolves.toBeTruthy();
    await expect(line(invoice.id, { amount: '10', ivaRate: '100' })).resolves.toBeTruthy();
  });

  it('invtax_adjust: ±0.01 accepted, 0.02 rejected; (invoiceId, ivaRate) unique', async () => {
    const invoice = await makeInvoice(prisma, (await makeClient(prisma)).id);
    const tax = (ivaRate: string, ivaAmount: string) =>
      prisma.invoiceTaxLine.create({
        data: { invoiceId: invoice.id, ivaRate, taxBase: '100', ivaAmount },
      });
    await expect(tax('16', '16.00')).resolves.toBeTruthy(); // exact
    await expect(tax('8', '8.01')).resolves.toBeTruthy(); // +0.01
    await expect(tax('0', '-0.01')).resolves.toBeTruthy(); // -0.01 (0 % of 100 = 0)
    await expectViolation(tax('12', '12.02'), 'invtax_adjust'); // +0.02
    await expectViolation(tax('12', '11.98'), 'invtax_adjust'); // -0.02
    await expectViolation(tax('16', '16.00'), 'InvoiceTaxLine_invoiceId_ivaRate_key'); // duplicate rate
  });
});

describe('schema deltas', () => {
  it('Δ2/Δ4 columns and ShareEvent values exist; Invoice.ivaRate is gone', async () => {
    const cols = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`;
    const has = (t: string, c: string) =>
      cols.some((x) => x.table_name === t && x.column_name === c);
    expect(has('ShareLinkDocument', 'accessKeyHash')).toBe(true);
    expect(has('ShareLinkDocument', 'accessKeyUpdatedAt')).toBe(true);
    expect(has('Technology', 'nameEn')).toBe(true);
    expect(has('Invoice', 'ivaRate')).toBe(false);
    expect(has('InvoiceLine', 'netAmount')).toBe(true);
    expect(has('Account', 'balance')).toBe(true);
    expect(has('Account', 'balanceAt')).toBe(true);
    expect(has('ActivityLog', 'clientId')).toBe(true);
    expect(has('AlertState', 'readAt')).toBe(true);
    expect(has('RecurringCharge', 'monthlyAmountUsd')).toBe(true);
    expect(has('RecurringExpense', 'usdRate')).toBe(true);
    const labels = await prisma.$queryRaw<{ enumlabel: string }[]>`
      SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid WHERE t.typname = 'ShareEvent'`;
    const values = labels.map((l) => l.enumlabel);
    expect(values).toEqual(expect.arrayContaining(['VIEW', 'DOWNLOAD', 'UNLOCK', 'UNLOCK_FAILED']));
  });
});

describe('Δ BE-3 columns (Q-BE3-2)', () => {
  it('BillingPlan.contractedUsd and usdRate accept NULL and exact decimals', async () => {
    const empty = await makeProject(prisma);
    const withNulls = await prisma.billingPlan.create({
      data: { projectId: empty.id, model: 'PRECIO_FIJO', currency: 'USD' },
    });
    expect(withNulls.contractedUsd).toBeNull();
    expect(withNulls.usdRate).toBeNull();
    const other = await makeProject(prisma);
    const exact = await prisma.billingPlan.create({
      data: {
        projectId: other.id,
        model: 'PRECIO_FIJO',
        currency: 'USD',
        contractedUsd: '1234567890123456.78',
        usdRate: '123456789012.12345678',
      },
    });
    expect(exact.contractedUsd?.toFixed(2)).toBe('1234567890123456.78');
    expect(exact.usdRate?.toFixed(8)).toBe('123456789012.12345678');
  });

  it('resumedOn accepts NULL and a date on RecurringCharge and RecurringExpense; existing CHECKs still hold', async () => {
    const project = await makeProject(prisma);
    const charge = (billingDay: number, resumedOn?: Date) =>
      prisma.recurringCharge.create({
        data: {
          projectId: project.id,
          label: 'Hosting',
          amount: '10',
          currency: 'USD',
          frequency: 'MENSUAL',
          startDate: new Date('2026-01-01'),
          billingDay,
          usdRate: '1',
          monthlyAmountUsd: '10',
          resumedOn,
        },
      });
    expect((await charge(1)).resumedOn).toBeNull();
    const resumed = await charge(2, new Date('2026-03-05'));
    expect(resumed.resumedOn?.toISOString().slice(0, 10)).toBe('2026-03-05');
    await expectViolation(charge(29, new Date('2026-03-05')), 'rc_billing_day');

    const category = await prisma.expenseCategory.findFirstOrThrow();
    const expense = (dayOfPeriod: number, resumedOn?: Date) =>
      prisma.recurringExpense.create({
        data: {
          name: uid('RE'),
          categoryId: category.id,
          currency: 'USD',
          amount: '10',
          frequency: 'MENSUAL',
          dayOfPeriod,
          startDate: new Date('2026-01-01'),
          usdRate: '1',
          monthlyAmountUsd: '10',
          resumedOn,
        },
      });
    expect((await expense(1)).resumedOn).toBeNull();
    const resumedExpense = await expense(2, new Date('2026-03-05'));
    expect(resumedExpense.resumedOn?.toISOString().slice(0, 10)).toBe('2026-03-05');
    await expectViolation(expense(29, new Date('2026-03-05')), 're_day');
  });
});

describe('Δ15 document and share deltas (DT-136, DT-137)', () => {
  it('two versions may reference one File (restore reuses the file)', async () => {
    const user = await makeUser(prisma);
    const doc = await makeDocument(prisma);
    const file = await prisma.file.create({
      data: {
        storageKey: uid('documents/k'),
        bucket: 'b',
        originalName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1,
        uploadedById: user.id,
      },
    });
    const version = (versionNumber: number) =>
      prisma.documentVersion.create({
        data: {
          documentId: doc.id,
          versionNumber,
          format: 'ARCHIVO',
          fileId: file.id,
          createdById: user.id,
        },
      });
    await version(1);
    await expect(version(2)).resolves.toBeTruthy();
    const withVersions = await prisma.file.findUniqueOrThrow({
      where: { id: file.id },
      include: { documentVersions: true },
    });
    expect(withVersions.documentVersions).toHaveLength(2);
  });

  it('ShareLink.expiresAt stores a date only; expiredAt accepts NULL and a timestamp', async () => {
    const user = await makeUser(prisma);
    const link = await prisma.shareLink.create({
      data: {
        token: uid('tok'),
        title: 'Link',
        createdById: user.id,
        expiresAt: new Date('2026-12-31T15:45:10.000Z'),
      },
    });
    expect(link.expiredAt).toBeNull();
    expect(link.expiresAt?.toISOString()).toBe('2026-12-31T00:00:00.000Z');
    const marked = await prisma.shareLink.update({
      where: { id: link.id },
      data: { expiredAt: new Date('2027-01-01T04:05:06.000Z') },
    });
    expect(marked.expiredAt?.toISOString()).toBe('2027-01-01T04:05:06.000Z');
  });

  it('ShareLinkDocument(documentId) is indexed; doclink_one_target still holds', async () => {
    const rows = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'ShareLinkDocument'`;
    expect(rows.some((r) => r.indexdef.includes('("documentId")'))).toBe(true);
    const versionIdx = await prisma.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'DocumentVersion' AND indexdef LIKE '%("fileId")%'`;
    expect(versionIdx).toHaveLength(1);
    expect(versionIdx[0]?.indexdef).not.toContain('UNIQUE');
    const doc = await makeDocument(prisma);
    await expectViolation(
      prisma.documentLink.create({ data: { documentId: doc.id } }),
      'doclink_one_target',
    );
  });
});

describe('read models (data-rules §3b)', () => {
  it('ClientMetrics and ProjectMetrics cascade on delete', async () => {
    const client = await makeClient(prisma);
    const project = await makeProject(prisma);
    await prisma.clientMetrics.create({ data: { clientId: client.id } });
    await prisma.projectMetrics.create({ data: { projectId: project.id } });
    await prisma.client.delete({ where: { id: client.id } });
    await prisma.project.delete({ where: { id: project.id } });
    expect(await prisma.clientMetrics.count()).toBe(0);
    expect(await prisma.projectMetrics.count()).toBe(0);
  });

  it('account_ledger_v returns a running balance (opening, payment, expense, transfer)', async () => {
    const client = await makeClient(prisma);
    const a = await makeAccount(prisma, {
      openingBalance: '100',
      openingDate: new Date('2026-01-01'),
    });
    const b = await makeAccount(prisma, {
      openingBalance: '0',
      openingDate: new Date('2026-01-01'),
    });
    await makePayment(prisma, client.id, a.id, {
      amount: '50',
      netCredited: '50',
      date: new Date('2026-01-02'),
    });
    await makeExpense(prisma, a.id, { amount: '20', paidAt: new Date('2026-01-03') });
    await prisma.accountTransfer.create({
      data: {
        date: new Date('2026-01-04'),
        fromAccountId: a.id,
        toAccountId: b.id,
        amountFrom: '10',
        amountTo: '10',
        feeAmount: '1',
        amountUsd: '10',
      },
    });

    const rows = await prisma.$queryRaw<{ kind: string; amount: string; balance: string }[]>`
      SELECT kind, amount::text AS amount, balance::text AS balance FROM account_ledger_v
      WHERE "accountId" = ${a.id} ORDER BY "date", seq`;
    expect(rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['OPENING', '100.00', '100.00'],
      ['PAYMENT', '50.00', '150.00'],
      ['EXPENSE', '-20.00', '130.00'],
      ['TRANSFER_OUT', '-11.00', '119.00'],
    ]);

    const other = await prisma.$queryRaw<{ kind: string; balance: string }[]>`
      SELECT kind, balance::text AS balance FROM account_ledger_v
      WHERE "accountId" = ${b.id} ORDER BY "date", seq`;
    expect(other.map((r) => [r.kind, r.balance])).toEqual([
      ['OPENING', '0.00'],
      ['TRANSFER_IN', '10.00'],
    ]);
  });

  it('account_ledger_v applies the movement type sign (APORTE +, RETIRO -, AJUSTE as stored; DT-106)', async () => {
    const a = await makeAccount(prisma, {
      openingBalance: '100',
      openingDate: new Date('2026-01-01'),
    });
    const move = (
      type: 'APORTE_CAPITAL' | 'RETIRO_SOCIO' | 'AJUSTE',
      amount: string,
      day: string,
    ) =>
      prisma.accountMovement.create({
        data: {
          accountId: a.id,
          type,
          date: new Date(day),
          amount,
          amountUsd: amount,
          description: type,
        },
      });
    await move('APORTE_CAPITAL', '50', '2026-01-02');
    await move('RETIRO_SOCIO', '30', '2026-01-03');
    await move('AJUSTE', '-5', '2026-01-04');
    await move('AJUSTE', '2', '2026-01-05');
    const rows = await prisma.$queryRaw<{ kind: string; amount: string; balance: string }[]>`
      SELECT kind, amount::text AS amount, balance::text AS balance FROM account_ledger_v
      WHERE "accountId" = ${a.id} ORDER BY "date", seq`;
    expect(rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['OPENING', '100.00', '100.00'],
      ['MOVEMENT', '50.00', '150.00'],
      ['MOVEMENT', '-30.00', '120.00'],
      ['MOVEMENT', '-5.00', '115.00'],
      ['MOVEMENT', '2.00', '117.00'],
    ]);
  });

  it('account_ledger_v orders same-date rows by seq: opening, payment, expense, transfers, movement (DT-105)', async () => {
    const client = await makeClient(prisma);
    const day = new Date('2026-01-10');
    const a = await makeAccount(prisma, { openingBalance: '100', openingDate: day });
    const b = await makeAccount(prisma, { openingBalance: '0', openingDate: day });
    // Insert in the reverse of the expected order; seq must decide, not insertion time.
    await prisma.accountMovement.create({
      data: {
        accountId: a.id,
        type: 'APORTE_CAPITAL',
        date: day,
        amount: '1',
        amountUsd: '1',
        description: 'm',
      },
    });
    await prisma.accountTransfer.create({
      data: {
        date: day,
        fromAccountId: b.id,
        toAccountId: a.id,
        amountFrom: '4',
        amountTo: '4',
        amountUsd: '4',
      },
    });
    await prisma.accountTransfer.create({
      data: {
        date: day,
        fromAccountId: a.id,
        toAccountId: b.id,
        amountFrom: '3',
        amountTo: '3',
        amountUsd: '3',
      },
    });
    await makeExpense(prisma, a.id, { amount: '2', paidAt: day });
    await makePayment(prisma, client.id, a.id, { amount: '10', netCredited: '10', date: day });
    const rows = await prisma.$queryRaw<{ kind: string; balance: string }[]>`
      SELECT kind, balance::text AS balance FROM account_ledger_v
      WHERE "accountId" = ${a.id} ORDER BY "date", seq, "createdAt", "sourceId"`;
    expect(rows.map((r) => [r.kind, r.balance])).toEqual([
      ['OPENING', '100.00'],
      ['PAYMENT', '110.00'],
      ['EXPENSE', '108.00'],
      ['TRANSFER_OUT', '105.00'],
      ['TRANSFER_IN', '109.00'],
      ['MOVEMENT', '110.00'],
    ]);
    // The view's own running balance is what readers use: it must agree with the ordered listing.
    const viaView = await prisma.$queryRaw<{ balance: string }[]>`
      SELECT balance::text AS balance FROM account_ledger_v WHERE "accountId" = ${a.id}
      ORDER BY balance DESC LIMIT 1`;
    expect(viaView[0]?.balance).toBe('110.00');
  });

  it('account_ledger_v debits accountAmount when the expense currency differs from the account', async () => {
    const a = await makeAccount(prisma, {
      openingBalance: '100',
      openingDate: new Date('2026-01-01'),
    });
    const e = await makeExpense(prisma, a.id, { amount: '1000', paidAt: new Date('2026-01-02') });
    await prisma.expense.update({
      where: { id: e.id },
      data: { currency: 'VES', accountAmount: '25.50', amountUsd: '25.50' },
    });
    const rows = await prisma.$queryRaw<{ kind: string; amount: string; balance: string }[]>`
      SELECT kind, amount::text AS amount, balance::text AS balance FROM account_ledger_v
      WHERE "accountId" = ${a.id} ORDER BY "date", seq`;
    expect(rows.map((r) => [r.kind, r.amount, r.balance])).toEqual([
      ['OPENING', '100.00', '100.00'],
      ['EXPENSE', '-25.50', '74.50'],
    ]);
  });

  it('account_ledger_v dates a PAGADO expense with null paidAt by its date', async () => {
    const a = await makeAccount(prisma, {
      openingBalance: '50',
      openingDate: new Date('2026-01-01'),
    });
    const e = await makeExpense(prisma, a.id, { amount: '8', paidAt: new Date('2026-01-05') });
    await prisma.expense.update({ where: { id: e.id }, data: { paidAt: null } });
    const rows = await prisma.$queryRaw<{ kind: string; date: Date; balance: string }[]>`
      SELECT kind, "date", balance::text AS balance FROM account_ledger_v
      WHERE "accountId" = ${a.id} ORDER BY "date", seq`;
    expect(rows.map((r) => [r.kind, r.date.toISOString().slice(0, 10), r.balance])).toEqual([
      ['OPENING', '2026-01-01', '50.00'],
      ['EXPENSE', '2026-01-05', '42.00'],
    ]);
  });

  it('account_ledger_v ignores unconfirmed payments and archived rows', async () => {
    const client = await makeClient(prisma);
    const a = await makeAccount(prisma, {
      openingBalance: '5',
      openingDate: new Date('2026-01-01'),
    });
    const pending = await makePayment(prisma, client.id, a.id, { amount: '10' });
    await prisma.payment.update({
      where: { id: pending.id },
      data: { status: 'PENDIENTE_VERIFICACION' },
    });
    const archived = await makePayment(prisma, client.id, a.id, { amount: '10' });
    await prisma.payment.update({ where: { id: archived.id }, data: { deletedAt: new Date() } });
    const rows = await prisma.$queryRaw<{ kind: string }[]>`
      SELECT kind FROM account_ledger_v WHERE "accountId" = ${a.id}`;
    expect(rows.map((r) => r.kind)).toEqual(['OPENING']);
  });
});
