import type { PrismaClient } from '../../src/generated/prisma/client';

let counter = 0;
export const uid = (prefix = 'x'): string => `${prefix}${++counter}_${Date.now().toString(36)}`;

const DATE = new Date('2026-01-15T00:00:00.000Z');

/** Runs a statement expected to violate `constraint`; asserts the rejection names it. */
export async function expectViolation(
  promise: Promise<unknown>,
  constraint: string,
): Promise<void> {
  let message = '';
  try {
    await promise;
  } catch (error) {
    message = JSON.stringify(error, Object.getOwnPropertyNames(error as object)) + String(error);
  }
  if (!message)
    throw new Error(`Expected a violation of ${constraint}, but the statement succeeded`);
  if (!message.includes(constraint)) {
    throw new Error(`Expected a violation of ${constraint}, got: ${message.slice(0, 400)}`);
  }
}

export async function makeClient(
  prisma: PrismaClient,
  data: { taxId?: string; country?: string } = {},
) {
  const n = uid('cli');
  return prisma.client.create({
    data: {
      code: n,
      kind: 'EMPRESA',
      tradeName: `Trade ${n}`,
      legalName: `Legal ${n}`,
      taxId: data.taxId ?? `J-${n}`,
      country: data.country ?? 'VE',
      address: 'Test address',
      phone: '+58 000 0000',
    },
  });
}

export async function makeContact(
  prisma: PrismaClient,
  clientId: string,
  isPrimary = false,
  deleted = false,
) {
  return prisma.contact.create({
    data: { clientId, fullName: uid('Contact'), isPrimary, deletedAt: deleted ? DATE : null },
  });
}

export async function makeProject(prisma: PrismaClient) {
  const n = uid('pry');
  return prisma.project.create({ data: { code: n, name: n, summary: 'summary' } });
}

export async function makeUser(prisma: PrismaClient) {
  const n = uid('usr');
  return prisma.user.create({ data: { clerkId: n, email: `${n}@example.com`, name: n } });
}

export async function makeDocument(prisma: PrismaClient) {
  const n = uid('doc');
  return prisma.document.create({ data: { code: n, title: n, typeId: 'dtyp_prd' } });
}

export async function makeNote(prisma: PrismaClient) {
  const author = await makeUser(prisma);
  return prisma.note.create({
    data: { content: {}, contentText: 'note', authorId: author.id },
  });
}

export async function makeTag(prisma: PrismaClient) {
  const n = uid('tag');
  return prisma.tag.create({ data: { name: n, color: '#000000' } });
}

export async function makeAccount(
  prisma: PrismaClient,
  data: { openingBalance?: string; openingDate?: Date } = {},
) {
  return prisma.account.create({
    data: {
      name: uid('Account'),
      type: 'BANCO_NACIONAL',
      currency: 'USD',
      openingBalance: data.openingBalance ?? '0',
      openingDate: data.openingDate ?? DATE,
    },
  });
}

export async function makeInvoice(
  prisma: PrismaClient,
  clientId: string,
  data: { invoiceNumber?: string; deleted?: boolean } = {},
) {
  const n = uid('fac');
  return prisma.invoice.create({
    data: {
      code: n,
      clientId,
      invoiceNumber: data.invoiceNumber ?? n,
      issueDate: DATE,
      dueDate: DATE,
      currency: 'USD',
      usdRate: '1',
      subtotal: '100',
      taxBase: '100',
      ivaAmount: '16',
      total: '116',
      receivable: '116',
      totalUsd: '116',
      receivableUsd: '116',
      balance: '116',
      deletedAt: data.deleted ? DATE : null,
    },
  });
}

export async function makePayment(
  prisma: PrismaClient,
  clientId: string,
  accountId: string,
  data: {
    amount?: string;
    igtfAmount?: string;
    feeAmount?: string;
    netCredited?: string;
    date?: Date;
  } = {},
) {
  const method = await prisma.paymentMethod.findFirstOrThrow();
  const n = uid('pag');
  return prisma.payment.create({
    data: {
      code: n,
      clientId,
      accountId,
      methodId: method.id,
      date: data.date ?? DATE,
      currency: 'USD',
      amount: data.amount ?? '50',
      igtfAmount: data.igtfAmount ?? '0',
      feeAmount: data.feeAmount ?? '0',
      netCredited: data.netCredited ?? data.amount ?? '50',
      allocatable: data.amount ?? '50',
      unallocated: data.amount ?? '50',
      usdRate: '1',
      amountUsd: data.amount ?? '50',
    },
  });
}

export async function makeExpense(
  prisma: PrismaClient,
  accountId: string | null,
  data: { amount?: string; paidAt?: Date } = {},
) {
  const n = uid('gas');
  return prisma.expense.create({
    data: {
      code: n,
      date: data.paidAt ?? DATE,
      paidAt: data.paidAt ?? DATE,
      description: 'expense',
      categoryId: 'ecat_hosting',
      accountId,
      currency: 'USD',
      amount: data.amount ?? '20',
      usdRate: '1',
      amountUsd: data.amount ?? '20',
      status: 'PAGADO',
    },
  });
}
