import type { CurrentUser } from '../../../../src/shared/application/current-user';
import Decimal from 'decimal.js';
import { toDecimal } from '../../../../src/shared/domain/money';
import { addDays, rateFor, type Ctx, type Operation } from './ops-base';

const as = (actor: unknown) => actor as CurrentUser;
const CLIENTS = ['cli_a', 'cli_b', 'cli_c'];

function methodFor(ctx: Ctx, currency: string): { methodId: string; igtf: boolean } {
  const code = currency === 'VES' ? 'EFECTIVO_VES' : ctx.rng.pick(['ZELLE', 'EFECTIVO_USD']);
  return {
    methodId: ctx.refs.methods[code] as string,
    igtf: code === 'ZELLE' || code === 'EFECTIVO_USD',
  };
}

async function openInvoices(ctx: Ctx, clientId: string) {
  return ctx.world.db.invoice.findMany({
    where: {
      clientId,
      deletedAt: null,
      voidedAt: null,
      isDraft: false,
      balance: { gt: 0 },
    },
  });
}

/**
 * An allocation of part of an invoice's balance, spending part of the payment amount. In the same currency
 * both sides are one amount (`payments.validation.allocationSameCurrency`); across currencies they differ.
 */
function allocationFor(
  ctx: Ctx,
  invoice: { id: string; currency: string; balance: { toFixed(n: number): string } },
  payment: { currency: string; available: string },
) {
  // Often the whole balance, so invoices reach PAGADA and the installments they bill reach COBRADA.
  const invoicePart = toDecimal(invoice.balance.toFixed(2))
    .times(ctx.rng.chance(0.4) ? 100 : ctx.rng.int(20, 99))
    .div(100);
  if (invoice.currency === payment.currency) {
    const same = Decimal.min(invoicePart, toDecimal(payment.available)).toFixed(2);
    return { invoiceId: invoice.id, amountPaymentCurrency: same, amountInvoiceCurrency: same };
  }
  const paymentPart = toDecimal(payment.available).times(ctx.rng.int(20, 100)).div(100);
  return {
    invoiceId: invoice.id,
    amountPaymentCurrency: paymentPart.toFixed(2),
    amountInvoiceCurrency: invoicePart.toFixed(2),
  };
}

function fields(ctx: Ctx, account: { id: string; currency: string }, clientId: string) {
  const { methodId, igtf } = methodFor(ctx, account.currency);
  const amount = ctx.rng.money(40, 1200);
  return {
    clientId,
    date: addDays(ctx.today, -ctx.rng.int(0, 15)),
    accountId: account.id,
    methodId,
    currency: account.currency,
    amount,
    igtfAmount: igtf && ctx.rng.chance(0.3) ? toDecimal(amount).times(0.03).toFixed(2) : '0.00',
    feeAmount: ctx.rng.chance(0.2) ? ctx.rng.money(0, 4) : '0.00',
    usdRate: rateFor(ctx, account.currency),
    reference: `REF-${ctx.nextNumber()}`,
  };
}

const createPayment: Operation = {
  name: 'createPayment',
  async plan(ctx) {
    const accounts = await ctx.world.db.account.findMany({ where: { active: true } });
    if (accounts.length === 0) return null;
    const clientId = ctx.rng.pick(CLIENTS);
    const base = fields(ctx, ctx.rng.pick(accounts), clientId);
    const open = await openInvoices(ctx, clientId);
    const allocations =
      open.length > 0 && ctx.rng.chance(0.6)
        ? [
            allocationFor(ctx, ctx.rng.pick(open), {
              currency: base.currency,
              available: toDecimal(base.amount)
                .minus(base.igtfAmount)
                .minus(base.feeAmount)
                .toFixed(2),
            }),
          ]
        : [];
    const input = {
      ...base,
      status: ctx.rng.pick(['CONFIRMADO', 'CONFIRMADO', 'PENDIENTE_VERIFICACION'] as const),
      allocations,
    };
    const uc = ctx.world.uc.createPayment;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () =>
        ctx.rng.chance(0.5)
          ? uc.execute(ctx.world.owner, { ...input, amount: '0' })
          : uc.execute(ctx.world.owner, { ...input, accountId: 'acc_missing' }),
    };
  },
};

const updatePayment: Operation = {
  name: 'updatePayment',
  async plan(ctx) {
    const rows = await ctx.world.db.payment.findMany({ where: { status: { not: 'ANULADO' } } });
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const accounts = await ctx.world.db.account.findMany({
      where: { active: true, currency: row.currency },
    });
    if (accounts.length === 0) return null;
    const input = {
      ...fields(
        ctx,
        ctx.rng.pick(accounts),
        ctx.rng.chance(0.9) ? row.clientId : ctx.rng.pick(CLIENTS),
      ),
      id: row.id,
    };
    const uc = ctx.world.uc.updatePayment;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, igtfAmount: '-1' }),
    };
  },
};

const setPaymentStatus: Operation = {
  name: 'setPaymentStatus',
  async plan(ctx) {
    const rows = await ctx.world.db.payment.findMany();
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const input = {
      id: row.id,
      status: ctx.rng.pick(['CONFIRMADO', 'ANULADO', 'ANULADO', 'PENDIENTE_VERIFICACION'] as const),
      reason: 'Verificacion',
    };
    const uc = ctx.world.uc.setPaymentStatus;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { id: 'pay_missing', status: 'ANULADO' }),
    };
  },
};

const allocate: Operation = {
  name: 'allocatePayment',
  async plan(ctx) {
    const payments = await ctx.world.db.payment.findMany({
      where: { status: 'CONFIRMADO', unallocated: { gt: 0 } },
    });
    if (payments.length === 0) return null;
    const payment = ctx.rng.pick(payments);
    const open = await openInvoices(ctx, payment.clientId);
    if (open.length === 0) return null;
    const input = {
      paymentId: payment.id,
      ...allocationFor(ctx, ctx.rng.pick(open), {
        currency: payment.currency,
        available: payment.unallocated.toFixed(2),
      }),
    };
    const uc = ctx.world.uc.allocate;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, invoiceId: 'inv_missing' }),
    };
  },
};

const deallocate: Operation = {
  name: 'deallocatePayment',
  async plan(ctx) {
    const rows = await ctx.world.db.paymentAllocation.findMany({ where: { deletedAt: null } });
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const uc = ctx.world.uc.deallocate;
    return {
      describe: row.id,
      run: (actor) => uc.execute(as(actor), { allocationId: row.id }),
      bad: () => uc.execute(ctx.world.owner, { allocationId: 'alloc_missing' }),
    };
  },
};

export const PAYMENTS: readonly Operation[] = [
  createPayment,
  updatePayment,
  setPaymentStatus,
  allocate,
  deallocate,
];
