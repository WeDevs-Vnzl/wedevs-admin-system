import { describe, expect, it } from 'vitest';
import { InMemoryAccountLedgerForBankMatch } from '../../support/fakes/in-memory-account-ledger-for-bank-match';
import { FAKE_STATEMENT_CONTENT_TYPE, InMemoryBank } from '../../support/fakes/in-memory-bank';
import { InMemoryExchange } from '../../support/fakes/in-memory-exchange';
import { InMemoryIntegrationEventStore } from '../../support/fakes/in-memory-integration-event-store';
import { InMemoryInvoiceForPaymentLink } from '../../support/fakes/in-memory-invoice-for-payment-link';
import { InMemoryPaymentLinkRepository } from '../../support/fakes/in-memory-payment-link-repository';
import { InMemoryPaymentProvider } from '../../support/fakes/in-memory-payment-provider';
import { bankContract } from './bank.contract';
import { exchangeContract } from './exchange.contract';
import { integrationEventStoreContract } from './integration-event-store.contract';
import { paymentLinkRepositoryContract } from './payment-link.repository.contract';
import { paymentProviderContract } from './payment-provider.contract';

paymentProviderContract('InMemory', () => {
  const provider = new InMemoryPaymentProvider();
  const knownPayment = {
    id: 'pi_known',
    amount: '60.00',
    currency: 'USD',
    fee: '2.04',
    paidAt: new Date('2026-11-02T10:00:00Z'),
    metadata: { invoiceId: 'inv-1', linkId: 'link-1' },
  };
  provider.addPayment(knownPayment);
  return {
    provider,
    knownPayment,
    unknownPaymentId: 'pi_unknown',
    validDelivery: () => {
      const expected = {
        eventId: 'evt_1',
        kind: 'PAYMENT_RECEIVED' as const,
        paymentId: 'pi_known',
      };
      const signed = provider.signedEvent({
        ...expected,
        type: 'payment_intent.succeeded',
        occurredAt: new Date('2026-11-02T10:00:00Z'),
        metadata: knownPayment.metadata,
      });
      return { ...signed, expected };
    },
    tampered: (delivery) => ({
      ...delivery,
      rawBody: delivery.rawBody.replace('evt_1', 'evt_2'),
    }),
  };
});

exchangeContract('InMemory', () => {
  const exchange = new InMemoryExchange(
    [
      { asset: 'USDT', free: '1250.50', locked: '0' },
      { asset: 'BTC', free: '0.00120000', locked: '0.00010000' },
    ],
    [
      {
        id: 'd2',
        asset: 'USDT',
        amount: '100',
        insertedAt: new Date('2026-11-02T12:00:00Z'),
        txId: null,
      },
      {
        id: 'd1',
        asset: 'USDT',
        amount: '50.25',
        insertedAt: new Date('2026-11-01T12:00:00Z'),
        txId: 'tx1',
      },
      {
        id: 'd0',
        asset: 'BTC',
        amount: '0.001',
        insertedAt: new Date('2026-10-01T12:00:00Z'),
        txId: 'tx0',
      },
    ],
  );
  return {
    port: exchange,
    cutoff: new Date('2026-11-01T12:00:00Z'),
    depositsBeforeCutoff: 1,
    depositsFromCutoff: 2,
  };
});

const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

bankContract('InMemory', () => ({
  port: new InMemoryBank(),
  valid: {
    bytes: encode('2026-11-02;100.00;REF-1;Transfer in\n2026-11-03;-25.50;;Card fee\n'),
    contentType: FAKE_STATEMENT_CONTENT_TYPE,
    expected: [
      {
        rowNumber: 1,
        date: '2026-11-02',
        amount: '100.00',
        reference: 'REF-1',
        description: 'Transfer in',
      },
      {
        rowNumber: 2,
        date: '2026-11-03',
        amount: '-25.50',
        reference: null,
        description: 'Card fee',
      },
    ],
  },
  malformed: {
    bytes: encode('2026-11-02;100.00;REF-1;ok\n2026-11-03;abc;;broken\n'),
    contentType: FAKE_STATEMENT_CONTENT_TYPE,
    rowNumber: 2,
  },
  unsupportedContentType: 'application/pdf',
}));

integrationEventStoreContract('InMemory', () => ({ store: new InMemoryIntegrationEventStore() }));

paymentLinkRepositoryContract('InMemory', () => ({
  repository: new InMemoryPaymentLinkRepository(),
}));

describe('the remaining fakes', () => {
  it('scopes the ledger fake by account and date window', async () => {
    const ledger = new InMemoryAccountLedgerForBankMatch();
    ledger.seed('acc-1', [
      { id: 'r1', kind: 'PAYMENT', date: '2026-11-01', amount: '10.00', reference: null },
      { id: 'r2', kind: 'EXPENSE', date: '2026-11-09', amount: '-5.00', reference: null },
    ]);
    expect((await ledger.entries('acc-1', '2026-11-01', '2026-11-05')).map((r) => r.id)).toEqual([
      'r1',
    ]);
    expect(await ledger.entries('acc-2', '2026-11-01', '2026-11-30')).toEqual([]);
  });

  it('refuses an unknown invoice and returns a known one', async () => {
    const invoices = new InMemoryInvoiceForPaymentLink();
    invoices.add({
      id: 'inv-1',
      number: 'F-1',
      clientId: 'c-1',
      currency: 'USD',
      openBalance: '100.00',
      open: true,
    });
    expect((await invoices.load('inv-1')).openBalance).toBe('100.00');
    await expect(invoices.load('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
