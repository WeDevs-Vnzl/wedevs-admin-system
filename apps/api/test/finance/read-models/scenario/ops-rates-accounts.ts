import type { CurrentUser } from '../../../../src/shared/application/current-user';
import { addDays, CURRENCIES, rateFor, type Operation } from './ops-base';

const as = (actor: unknown) => actor as CurrentUser;

/** A rate rewrite never moves a snapshot: the USD amounts were fixed at write time (C16). */
const upsertRate: Operation = {
  name: 'upsertExchangeRate',
  rateRewrite: true,
  async plan(ctx) {
    const currency = ctx.rng.pick(['VES', 'EUR'] as const);
    const input = {
      date: addDays(ctx.today, -ctx.rng.int(0, 25)),
      currency,
      usdRate: rateFor(ctx, currency),
      source: ctx.rng.pick(['MANUAL', 'BCV', 'OTRA'] as const),
    };
    const uc = ctx.world.uc.upsertRate;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, usdRate: '0' }),
    };
  },
};

const loadDailyRates: Operation = {
  name: 'loadDailyRates',
  rateRewrite: true,
  async plan(ctx) {
    const input = {
      date: addDays(ctx.today, -ctx.rng.int(0, 10)),
      source: ctx.rng.pick(['BCV', 'MANUAL'] as const),
      rates: [
        { currency: 'VES', usdRate: rateFor(ctx, 'VES') },
        { currency: 'EUR', usdRate: rateFor(ctx, 'EUR') },
      ],
    };
    const uc = ctx.world.uc.loadDailyRates;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () =>
        uc.execute(ctx.world.owner, { ...input, rates: [{ currency: 'ZZZ', usdRate: '1' }] }),
    };
  },
};

const importRates: Operation = {
  name: 'importRatesCsv',
  rateRewrite: true,
  async plan(ctx) {
    const rows = [0, 1, 2].map((offset) => ({
      date: addDays(ctx.today, -ctx.rng.int(0, 20) - offset),
      currency: 'VES',
      usdRate: rateFor(ctx, 'VES'),
      source: 'MANUAL' as const,
    }));
    const input = { rows, overwrite: ctx.rng.chance(0.5) };
    const uc = ctx.world.uc.importRates;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { rows: [], overwrite: false }),
    };
  },
};

const createAccount: Operation = {
  name: 'createAccount',
  async plan(ctx) {
    if ((await ctx.world.db.account.count()) >= 8) return null;
    const currency = ctx.rng.pick(CURRENCIES);
    const input = {
      name: `Cuenta ${ctx.nextNumber()}`,
      type: ctx.rng.pick(['BANCO_NACIONAL', 'BANCO_INTERNACIONAL', 'EFECTIVO'] as const),
      currency,
      openingBalance: ctx.rng.money(0, 5000),
      openingDate: addDays(ctx.today, -ctx.rng.int(5, 40)),
    };
    const uc = ctx.world.uc.createAccount;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, name: '  ' }),
    };
  },
};

const updateAccount: Operation = {
  name: 'updateAccount',
  async plan(ctx) {
    const account = ctx.rng.pick(await ctx.world.db.account.findMany());
    const input = {
      ...(ctx.rng.chance(0.5) ? { name: `Renombrada ${ctx.nextNumber()}` } : {}),
      ...(ctx.rng.chance(0.6) ? { openingBalance: ctx.rng.money(0, 4000) } : {}),
      ...(ctx.rng.chance(0.3) ? { active: ctx.rng.chance(0.7) } : {}),
      ...(ctx.rng.chance(0.2) ? { openingDate: addDays(ctx.today, -ctx.rng.int(5, 40)) } : {}),
      ...(ctx.rng.chance(0.15) ? { currency: ctx.rng.pick(CURRENCIES) } : {}),
    };
    const uc = ctx.world.uc.updateAccount;
    return {
      describe: `${account.id} ${JSON.stringify(input)}`,
      run: (actor) => uc.execute(as(actor), account.id, input),
      bad: () => uc.execute(ctx.world.owner, account.id, { openingBalance: 'not-money' }),
    };
  },
};

const createTransfer: Operation = {
  name: 'createTransfer',
  async plan(ctx) {
    const accounts = await ctx.world.db.account.findMany({ where: { active: true } });
    if (accounts.length < 2) return null;
    const from = ctx.rng.pick(accounts);
    const to = ctx.rng.pick(accounts.filter((account) => account.id !== from.id));
    const amountFrom = ctx.rng.money(10, 600);
    const input = {
      date: addDays(ctx.today, -ctx.rng.int(0, 10)),
      fromAccountId: from.id,
      toAccountId: to.id,
      amountFrom,
      amountTo: from.currency === to.currency ? amountFrom : ctx.rng.money(10, 600),
      feeAmount: ctx.rng.chance(0.4) ? ctx.rng.money(0, 5) : '0',
      usdRate: rateFor(ctx, from.currency),
    };
    const uc = ctx.world.uc.createTransfer;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, toAccountId: from.id }),
    };
  },
};

const createMovement: Operation = {
  name: 'createMovement',
  async plan(ctx) {
    const accounts = await ctx.world.db.account.findMany({ where: { active: true } });
    if (accounts.length === 0) return null;
    const account = ctx.rng.pick(accounts);
    const type = ctx.rng.pick(['APORTE_CAPITAL', 'RETIRO_SOCIO', 'AJUSTE'] as const);
    const magnitude = ctx.rng.money(5, 400);
    const input = {
      accountId: account.id,
      type,
      date: addDays(ctx.today, -ctx.rng.int(0, 10)),
      amount: type === 'AJUSTE' && ctx.rng.chance(0.5) ? `-${magnitude}` : magnitude,
      usdRate: rateFor(ctx, account.currency),
      partnerId: type === 'AJUSTE' ? null : ctx.world.owner.userId,
      description: `Movimiento ${ctx.nextNumber()}`,
    };
    const uc = ctx.world.uc.createMovement;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, type: 'AJUSTE', amount: '0' }),
    };
  },
};

const reconcile: Operation = {
  name: 'reconcileAccount',
  async plan(ctx) {
    const account = ctx.rng.pick(await ctx.world.db.account.findMany());
    const input = { date: ctx.today, statementBalance: ctx.rng.money(0, 6000) };
    const uc = ctx.world.uc.reconcile;
    return {
      describe: `${account.id} ${JSON.stringify(input)}`,
      run: (actor) => uc.execute(as(actor), account.id, input),
      bad: () => uc.execute(ctx.world.owner, account.id, { ...input, statementBalance: 'x' }),
    };
  },
};

export const RATES_AND_ACCOUNTS: readonly Operation[] = [
  upsertRate,
  loadDailyRates,
  importRates,
  createAccount,
  updateAccount,
  createTransfer,
  createMovement,
  reconcile,
];
