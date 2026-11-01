import type { Actor } from '../../../../src/shared/application/actor';
import type { CurrentUser } from '../../../../src/shared/application/current-user';
import { addDays, dayOf, rateFor, type Ctx, type Operation } from './ops-base';

const as = (actor: unknown) => actor as CurrentUser;

interface LineSpec {
  description: string;
  projectId: string | null;
  installmentId: string | null;
  quantity: string;
  unitPrice: string;
  discount: string;
  ivaRate: string | null;
}

async function projectsOf(ctx: Ctx, clientId: string): Promise<string[]> {
  const links = await ctx.world.db.projectClient.findMany({
    where: { clientId, project: { deletedAt: null } },
  });
  return links.map((link) => link.projectId);
}

/** A bill-able installment of the client's projects in the invoice currency, or null. */
async function installmentFor(ctx: Ctx, clientId: string, currency: string) {
  const projects = await projectsOf(ctx, clientId);
  const rows = await ctx.world.db.billingInstallment.findMany({
    where: { projectId: { in: projects }, status: 'PENDIENTE', currency },
  });
  return rows.length === 0 ? null : ctx.rng.pick(rows);
}

async function lines(ctx: Ctx, clientId: string, currency: string): Promise<LineSpec[]> {
  const projects = await projectsOf(ctx, clientId);
  const result: LineSpec[] = [];
  const installment = ctx.rng.chance(0.3) ? await installmentFor(ctx, clientId, currency) : null;
  if (installment) {
    result.push({
      description: `Cuota ${installment.label}`,
      projectId: installment.projectId,
      installmentId: installment.id,
      quantity: '1',
      unitPrice: installment.amount.toFixed(2),
      discount: '0',
      ivaRate: null,
    });
  }
  const count = ctx.rng.int(installment ? 0 : 1, 3);
  for (let index = 0; index < count; index += 1) {
    const unitPrice = ctx.rng.money(60, 900);
    result.push({
      description: `Servicio ${ctx.nextNumber()}`,
      projectId: ctx.rng.chance(0.85) ? ctx.rng.pick(projects) : null,
      installmentId: null,
      quantity: String(ctx.rng.int(1, 4)),
      unitPrice,
      discount: ctx.rng.chance(0.25) ? '5.00' : '0',
      ivaRate: ctx.rng.pick(['16', '16', '8', '0', null] as const),
    });
  }
  return result;
}

async function invoiceBody(ctx: Ctx, clientId: string, currency: string, number: string) {
  const specs = await lines(ctx, clientId, currency);
  const issueDate = addDays(ctx.today, -ctx.rng.int(0, 35));
  const hasSixteen = specs.some((line) => line.ivaRate === '16');
  return {
    clientId,
    invoiceNumber: number,
    issueDate,
    dueDate: addDays(issueDate, ctx.rng.int(5, 45)),
    currency,
    usdRate: rateFor(ctx, currency),
    lines: specs,
    ...(hasSixteen && ctx.rng.chance(0.3)
      ? { taxAdjustments: [{ ivaRate: '16', adjustment: ctx.rng.pick(['0.01', '-0.01']) }] }
      : {}),
    ...(ctx.rng.chance(0.2) ? { islrWithheld: '1.00' } : {}),
    isDraft: ctx.rng.chance(0.15),
  };
}

function createInvoiceOperation(name: string, draft: boolean | null): Operation {
  return {
    name,
    async plan(ctx) {
      const clientId = ctx.rng.pick(['cli_a', 'cli_b', 'cli_c']);
      const currency = ctx.rng.pick(['USD', 'USD', 'VES', 'EUR'] as const);
      const body = await invoiceBody(ctx, clientId, currency, `F-${ctx.nextNumber()}`);
      const input = draft === null ? body : { ...body, isDraft: draft };
      const uc = ctx.world.uc.createInvoice;
      return {
        describe: JSON.stringify(input),
        run: (actor) => uc.execute(as(actor), input),
        bad: () =>
          ctx.rng.chance(0.5)
            ? uc.execute(ctx.world.owner, { ...input, dueDate: addDays(input.issueDate, -3) })
            : uc.execute(ctx.world.owner, { ...input, clientId: 'cli_missing' }),
      };
    },
  };
}

const createInvoice = createInvoiceOperation('createInvoice', null);
/** The same use case, always as a draft: `issueDraft` needs one to act on. */
const createDraftInvoice = createInvoiceOperation('createInvoice(draft)', true);

const editableInvoices = (ctx: Ctx) =>
  ctx.world.db.invoice.findMany({ where: { deletedAt: null, voidedAt: null } });

const updateInvoice: Operation = {
  name: 'updateInvoice',
  async plan(ctx) {
    const rows = await editableInvoices(ctx);
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    // Mostly the same client and currency (the integrity lock); sometimes a change the lock may refuse.
    const clientId = ctx.rng.chance(0.85)
      ? row.clientId
      : ctx.rng.pick(['cli_a', 'cli_b', 'cli_c']);
    const currency = ctx.rng.chance(0.9) ? row.currency : ctx.rng.pick(['USD', 'VES', 'EUR']);
    const input = {
      ...(await invoiceBody(ctx, clientId, currency, row.invoiceNumber)),
      id: row.id,
      isDraft: row.isDraft,
    };
    const uc = ctx.world.uc.updateInvoice;
    return {
      describe: JSON.stringify(input),
      run: (actor) => uc.execute(as(actor), input),
      bad: () => uc.execute(ctx.world.owner, { ...input, lines: [] }),
    };
  },
};

const issueDraft: Operation = {
  name: 'issueDraft',
  async plan(ctx) {
    const rows = await ctx.world.db.invoice.findMany({ where: { isDraft: true, deletedAt: null } });
    const row = rows.length > 0 ? ctx.rng.pick(rows) : null;
    const id = row?.id ?? 'inv_missing';
    const uc = ctx.world.uc.issueDraft;
    return {
      describe: id,
      run: (actor) => uc.execute(as(actor), { id }),
      bad: () => uc.execute(ctx.world.owner, { id: 'inv_missing' }),
    };
  },
};

const voidInvoice: Operation = {
  name: 'voidInvoice',
  async plan(ctx) {
    const rows = await editableInvoices(ctx);
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const uc = ctx.world.uc.voidInvoice;
    return {
      describe: row.id,
      run: (actor) => uc.execute(as(actor), { id: row.id, reason: 'Emitida por error' }),
      bad: () => uc.execute(ctx.world.owner, { id: row.id, reason: '  ' }),
    };
  },
};

const archiveInvoice: Operation = {
  name: 'archiveInvoice',
  async plan(ctx) {
    const rows = await ctx.world.db.invoice.findMany({ where: { deletedAt: null } });
    if (rows.length === 0) return null;
    const row = ctx.rng.pick(rows);
    const uc = ctx.world.uc.archiveInvoice;
    return {
      describe: row.id,
      run: (actor) => uc.execute(as(actor), { id: row.id }),
      bad: () => uc.execute(ctx.world.owner, { id: 'inv_missing' }),
    };
  },
};

const restoreInvoice: Operation = {
  name: 'restoreInvoice',
  async plan(ctx) {
    const rows = await ctx.world.db.invoice.findMany({ where: { deletedAt: { not: null } } });
    const row = rows.length > 0 ? ctx.rng.pick(rows) : null;
    const id = row?.id ?? 'inv_missing';
    const uc = ctx.world.uc.restoreInvoice;
    return {
      describe: id,
      run: (actor) => uc.execute(as(actor), id),
      // Restoring a live invoice is refused.
      bad: async () => {
        const live = await ctx.world.db.invoice.findFirst({ where: { deletedAt: null } });
        return uc.execute(ctx.world.owner, live?.id ?? 'inv_missing');
      },
    };
  },
};

/**
 * The clock moves forward, then the overdue step marks the invoices that went past their due date. The
 * clock only advances together with a successful step, so a refused attempt leaves time untouched.
 */
const markOverdue: Operation = {
  name: 'markOverdueInvoices',
  system: true,
  async plan(ctx) {
    const uc = ctx.world.uc.markOverdue;
    const days = ctx.rng.int(3, 30);
    return {
      describe: `advance ${days} days from ${ctx.today}`,
      run: (actor) => {
        if ((actor as Actor).actorType === 'SYSTEM') ctx.world.clock.advance(days * 86_400_000);
        return uc.execute(actor as Actor);
      },
    };
  },
};

export const INVOICES: readonly Operation[] = [
  createInvoice,
  createDraftInvoice,
  updateInvoice,
  issueDraft,
  voidInvoice,
  archiveInvoice,
  restoreInvoice,
  markOverdue,
];

export { dayOf };
