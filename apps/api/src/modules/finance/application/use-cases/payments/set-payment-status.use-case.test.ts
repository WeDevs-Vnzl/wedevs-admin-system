import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryPaymentLinkSettlement } from '../../../../../../test/support/fakes/in-memory-payment-link-settlement';
import { MatrixAuthorization } from '../../../../identity/application/matrix-authorization';
import {
  NOW,
  createPaymentsWorld,
  paymentInput,
  rejection,
  type PaymentsWorld,
} from '../../../../../../test/finance/payments/world';
import { SetPaymentStatus } from './set-payment-status.use-case';

let world: PaymentsWorld;
let settlement: InMemoryPaymentLinkSettlement;
let setStatus: SetPaymentStatus;

beforeEach(() => {
  world = createPaymentsWorld();
  settlement = new InMemoryPaymentLinkSettlement(world.uow);
  setStatus = new SetPaymentStatus(new MatrixAuthorization(), world.uow, world.support, settlement);
});

const linkPayment = async (status: 'PENDIENTE_VERIFICACION' | 'CONFIRMADO') => {
  const payment = await world.create.execute(world.owner, paymentInput({ status }));
  settlement.seedLink({
    id: 'lnk_1',
    invoiceId: 'inv_link',
    amount: '100.00',
    status: 'COMPLETED',
    paymentId: payment.id,
  });
  return payment;
};

describe('setPaymentStatus: the payment link settlement (DT-199)', () => {
  it('voiding a pending link payment settles its link', async () => {
    const payment = await linkPayment('PENDIENTE_VERIFICACION');

    await setStatus.execute(world.owner, { id: payment.id, status: 'ANULADO' });

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'SETTLED' });
    expect(settlement.link('lnk_1')?.settledAt).toBe(NOW);
  });

  it('voiding a confirmed link payment settles its link', async () => {
    const payment = await linkPayment('CONFIRMADO');

    await setStatus.execute(world.owner, { id: payment.id, status: 'ANULADO' });

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'SETTLED' });
  });

  it('confirming keeps the amount reserved: the link stays COMPLETED', async () => {
    const payment = await linkPayment('PENDIENTE_VERIFICACION');

    await setStatus.execute(world.owner, { id: payment.id, status: 'CONFIRMADO' });

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'COMPLETED' });
  });

  it('a refused transition leaves the link as it was', async () => {
    const payment = await linkPayment('PENDIENTE_VERIFICACION');
    await setStatus.execute(world.owner, { id: payment.id, status: 'ANULADO' });
    settlement.seedLink({
      id: 'lnk_1',
      invoiceId: 'inv_link',
      amount: '100.00',
      status: 'COMPLETED',
      paymentId: payment.id,
    });

    await rejection(setStatus.execute(world.owner, { id: payment.id, status: 'CONFIRMADO' }));

    expect(settlement.link('lnk_1')).toMatchObject({ status: 'COMPLETED' });
  });
});
