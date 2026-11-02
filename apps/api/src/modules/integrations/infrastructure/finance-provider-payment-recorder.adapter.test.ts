import { describe, expect, it, vi } from 'vitest';
import type { RecordProviderPayment } from '../../finance/application/use-cases/payments/record-provider-payment.use-case';
import type { RecordProviderPaymentCommand } from '../application/use-cases/stripe/provider-payment-recording.port';
import { FinanceProviderPaymentRecorder } from './finance-provider-payment-recorder.adapter';

const command: RecordProviderPaymentCommand = {
  provider: 'STRIPE',
  eventId: 'evt_1',
  eventType: 'payment_intent.succeeded',
  externalId: 'pi_1',
  clientId: 'cli_1',
  invoiceId: 'inv_1',
  linkId: 'lnk_1',
  amount: '60.00',
  currency: 'USD',
  fee: '2.04',
  receivedAt: new Date('2026-11-02T10:00:00Z'),
  accountId: 'acc_1',
  methodId: 'pm_1',
};

describe('FinanceProviderPaymentRecorder', () => {
  it.each([
    [{ outcome: 'RECORDED', paymentId: 'p1' }],
    [{ outcome: 'EXISTING', paymentId: 'p1' }],
    [{ outcome: 'DUPLICATE' }],
    [{ outcome: 'PARKED', reasonCode: 'NO_RATE' }],
  ] as const)('runs finance as SYSTEM and returns %j unchanged', async (result) => {
    const execute = vi.fn().mockResolvedValue(result);
    const adapter = new FinanceProviderPaymentRecorder({
      execute,
    } as unknown as RecordProviderPayment);
    expect(await adapter.record(command)).toEqual(result);
    expect(execute).toHaveBeenCalledWith({ actorType: 'SYSTEM', userId: null }, command);
  });
});
