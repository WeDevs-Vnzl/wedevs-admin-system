import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import {
  expectViolation,
  makeAccount,
  makeClient,
  makeInvoice,
  makePayment,
  makeUser,
  uid,
} from './helpers';

let prisma: PrismaClient;

beforeAll(async () => {
  prisma = createTestPrisma();
  await truncateBusinessTables(prisma);
});
beforeEach(async () => {
  await truncateBusinessTables(prisma);
});
afterAll(async () => {
  await truncateBusinessTables(prisma);
  await prisma.$disconnect();
});

const event = (eventId: string, provider: 'STRIPE' | 'BINANCE' | 'BANK' = 'STRIPE') => ({
  provider,
  eventId,
  type: 'checkout.session.completed',
  outcome: 'PROCESSED' as const,
});

async function invoiceWithUser() {
  const client = await makeClient(prisma);
  const invoice = await makeInvoice(prisma, client.id);
  const user = await makeUser(prisma);
  return { client, invoice, user };
}

const link = (invoiceId: string, createdById: string, over: Record<string, unknown> = {}) => ({
  invoiceId,
  requestId: randomUUID(),
  provider: 'STRIPE' as const,
  amount: '10.00',
  currency: 'USD',
  createdById,
  ...over,
});

describe('IntegrationEvent', () => {
  it('rejects a duplicate (provider, eventId) and accepts the same eventId on another provider', async () => {
    await prisma.integrationEvent.create({ data: event('evt_1') });
    await expectViolation(
      prisma.integrationEvent.create({ data: event('evt_1') }),
      'IntegrationEvent_provider_eventId_key',
    );
    await expect(
      prisma.integrationEvent.create({ data: event('evt_1', 'BINANCE') }),
    ).resolves.toBeTruthy();
  });

  it('accepts a parked event with no entity', async () => {
    const row = await prisma.integrationEvent.create({
      data: { ...event('evt_parked'), outcome: 'PARKED', reasonCode: 'payment.unknown_invoice' },
    });
    expect(row.entityType).toBeNull();
    expect(row.entityId).toBeNull();
    expect(row.processedAt).toBeNull();
  });
});

describe('ApiToken', () => {
  it('rejects a duplicate tokenHash', async () => {
    const user = await makeUser(prisma);
    const data = (hash: string) => ({
      userId: user.id,
      name: 'ci',
      prefix: 'wdv_abcdefgh',
      tokenHash: hash,
      expiresAt: new Date('2027-01-01T00:00:00Z'),
    });
    await prisma.apiToken.create({ data: data('a'.repeat(64)) });
    await expectViolation(
      prisma.apiToken.create({ data: data('a'.repeat(64)) }),
      'ApiToken_tokenHash_key',
    );
    await expect(prisma.apiToken.create({ data: data('b'.repeat(64)) })).resolves.toBeTruthy();
  });
});

describe('InvoicePaymentLink', () => {
  it('accepts two links on one invoice with different requestId and refuses the same requestId', async () => {
    const { invoice, user } = await invoiceWithUser();
    const requestId = randomUUID();
    await prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id, { requestId }) });
    await expect(
      prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id) }),
    ).resolves.toBeTruthy();
    await expectViolation(
      prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id, { requestId }) }),
      'InvoicePaymentLink_invoiceId_requestId_key',
    );
  });

  it('refuses a duplicate externalId but accepts several null externalIds', async () => {
    const { invoice, user } = await invoiceWithUser();
    await prisma.invoicePaymentLink.create({
      data: link(invoice.id, user.id, { externalId: 'plink_1' }),
    });
    await expectViolation(
      prisma.invoicePaymentLink.create({
        data: link(invoice.id, user.id, { externalId: 'plink_1' }),
      }),
      'InvoicePaymentLink_externalId_key',
    );
    await prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id) });
    await expect(
      prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id) }),
    ).resolves.toBeTruthy();
  });

  it('refuses two links pointing at the same payment', async () => {
    const { client, invoice, user } = await invoiceWithUser();
    const account = await makeAccount(prisma);
    const payment = await makePayment(prisma, client.id, account.id);
    await prisma.invoicePaymentLink.create({
      data: link(invoice.id, user.id, { paymentId: payment.id }),
    });
    await expectViolation(
      prisma.invoicePaymentLink.create({
        data: link(invoice.id, user.id, { paymentId: payment.id }),
      }),
      'InvoicePaymentLink_paymentId_key',
    );
  });

  it('refuses a zero or negative amount and accepts the smallest positive one', async () => {
    const { invoice, user } = await invoiceWithUser();
    await expectViolation(
      prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id, { amount: '0' }) }),
      'InvoicePaymentLink_amount_positive',
    );
    await expectViolation(
      prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id, { amount: '-1' }) }),
      'InvoicePaymentLink_amount_positive',
    );
    await expect(
      prisma.invoicePaymentLink.create({ data: link(invoice.id, user.id, { amount: '0.01' }) }),
    ).resolves.toBeTruthy();
  });
});

describe('Payment external pair (partial unique index)', () => {
  it('rejects a duplicate (externalProvider, externalId) and accepts several null pairs', async () => {
    const client = await makeClient(prisma);
    const account = await makeAccount(prisma);
    const a = await makePayment(prisma, client.id, account.id);
    const b = await makePayment(prisma, client.id, account.id);
    const c = await makePayment(prisma, client.id, account.id);
    const d = await makePayment(prisma, client.id, account.id);
    expect([a, b, c, d].every((p) => p.externalProvider === null && p.externalId === null)).toBe(
      true,
    );

    const pair = { externalProvider: 'STRIPE' as const, externalId: uid('pi') };
    await prisma.payment.update({ where: { id: a.id }, data: pair });
    await expectViolation(
      prisma.payment.update({ where: { id: b.id }, data: pair }),
      'Payment_externalProvider_externalId_key',
    );
    // Same id under another provider is a different pair.
    await expect(
      prisma.payment.update({
        where: { id: c.id },
        data: { ...pair, externalProvider: 'BINANCE' },
      }),
    ).resolves.toBeTruthy();
    // A half-set pair is not covered by the index.
    await prisma.payment.update({ where: { id: d.id }, data: { externalId: pair.externalId } });
    await expect(
      prisma.payment.update({ where: { id: b.id }, data: { externalId: pair.externalId } }),
    ).resolves.toBeTruthy();
  });
});
