import { describe, expect, it } from 'vitest';
import { ConflictError } from '../../../shared/domain';
import {
  PAYMENT_LINK_STATUS_VALUES,
  activateLink,
  canTransitionLink,
  completeLink,
  deactivateLink,
  isOpenLinkStatus,
  settleLink,
  type PaymentLink,
  type PaymentLinkStatus,
} from './payment-link';

const base: PaymentLink = {
  id: 'link-1',
  invoiceId: 'inv-1',
  requestId: '6f1f0b0e-2b5e-4d3a-9d62-0a6a3f2f1c11',
  provider: 'STRIPE',
  externalId: null,
  url: null,
  amount: '25.00',
  currency: 'USD',
  status: 'PENDING',
  paymentId: null,
  deactivationReason: null,
  createdAt: new Date('2026-11-02T10:00:00Z'),
  createdById: 'user-1',
  deactivatedAt: null,
  settledAt: null,
};
const at = new Date('2026-11-02T11:00:00Z');

describe('payment link transitions', () => {
  it('walks PENDING to ACTIVE to COMPLETED to SETTLED', () => {
    const active = activateLink(base, { externalId: 'plink_1', url: 'https://pay.example/1' });
    expect(active).toMatchObject({
      status: 'ACTIVE',
      externalId: 'plink_1',
      url: 'https://pay.example/1',
    });
    const completed = completeLink(active, 'pay-1');
    expect(completed).toMatchObject({ status: 'COMPLETED', paymentId: 'pay-1' });
    const settled = settleLink(completed, at);
    expect(settled).toMatchObject({ status: 'SETTLED', settledAt: at });
  });

  it('does not mutate its input', () => {
    activateLink(base, { externalId: 'plink_1', url: 'u' });
    expect(base.status).toBe('PENDING');
    expect(base.externalId).toBeNull();
  });

  it('deactivates a PENDING or ACTIVE link with a reason and a timestamp', () => {
    const fromPending = deactivateLink(base, 'PENDING_EXPIRED', at);
    expect(fromPending).toMatchObject({
      status: 'DEACTIVATED',
      deactivationReason: 'PENDING_EXPIRED',
      deactivatedAt: at,
    });
    const active = activateLink(base, { externalId: 'plink_1', url: 'u' });
    expect(deactivateLink(active, 'BALANCE_SHRUNK', at).status).toBe('DEACTIVATED');
  });

  it('allows exactly the documented transitions', () => {
    const allowed: Array<[PaymentLinkStatus, PaymentLinkStatus]> = [
      ['PENDING', 'ACTIVE'],
      ['ACTIVE', 'COMPLETED'],
      ['COMPLETED', 'SETTLED'],
      ['PENDING', 'DEACTIVATED'],
      ['ACTIVE', 'DEACTIVATED'],
    ];
    for (const from of PAYMENT_LINK_STATUS_VALUES) {
      for (const to of PAYMENT_LINK_STATUS_VALUES) {
        const expected = allowed.some(([f, t]) => f === from && t === to);
        expect(canTransitionLink(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }
  });

  it('refuses an illegal transition with a CONFLICT', () => {
    const completed = completeLink(activateLink(base, { externalId: 'p', url: 'u' }), 'pay-1');
    expect(() => deactivateLink(completed, 'X', at)).toThrow(ConflictError);
    expect(() => completeLink(base, 'pay-1')).toThrow(ConflictError);
    expect(() => activateLink(completed, { externalId: 'p', url: 'u' })).toThrow(ConflictError);
    expect(() => settleLink(base, at)).toThrow(ConflictError);
  });

  it('classifies PENDING and ACTIVE as open', () => {
    expect(PAYMENT_LINK_STATUS_VALUES.filter(isOpenLinkStatus)).toEqual(['PENDING', 'ACTIVE']);
  });
});
