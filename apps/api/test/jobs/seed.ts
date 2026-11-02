import type { PrismaClient } from '../../src/generated/prisma/client';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedExpense,
  seedInvoice,
  seedPayment,
  seedProject,
  type World,
} from '../finance/read-models/world';

/**
 * A non-empty business world for the job specs, as of the Caracas day 2026-10-28: two overdue invoices (one with a
 * payment), a payment, an expense, an expired and a live document, an expired and a live link, an active and a
 * paused recurring charge and an active recurring expense.
 */
export async function seedWorld(admin: PrismaClient, seed: World) {
  const user = await admin.user.create({
    data: { clerkId: 'user_job', email: 'job@example.test', name: 'Owner', role: 'OWNER' },
  });
  const typeId = (await admin.documentType.findFirstOrThrow()).id;
  await seed.uow.run(async () => {
    const db = seed.host.db;
    const { methodId, categoryId } = await catalogIds(db);
    await seedClient(db, 'cli_a');
    await seedClient(db, 'cli_b');
    await seedProject(db, 'pry_a', ['cli_a']);
    await seedProject(db, 'pry_b', ['cli_b']);
    await seedAccount(db, 'acc_usd', 'USD', '500.00');
    const line = (id: string, projectId: string, price: string) => ({
      id,
      projectId,
      unitPrice: price,
      ivaRate: '16.00',
    });
    // Due on the 27th: overdue on the 28th. The second has a payment that keeps it PARCIAL.
    await seedInvoice(db, {
      id: 'inv_a',
      clientId: 'cli_a',
      dueDate: '2026-10-27',
      lines: [line('l_a', 'pry_a', '1000.00')],
    });
    await seedInvoice(db, {
      id: 'inv_b',
      clientId: 'cli_b',
      dueDate: '2026-10-27',
      status: 'PARCIAL',
      lines: [line('l_b', 'pry_b', '500.00')],
    });
    await seedInvoice(db, {
      id: 'inv_ok',
      clientId: 'cli_a',
      dueDate: '2026-12-31',
      lines: [line('l_ok', 'pry_a', '200.00')],
    });
    await seedPayment(db, {
      id: 'pay_b',
      clientId: 'cli_b',
      accountId: 'acc_usd',
      methodId,
      amount: '100.00',
      allocations: [
        {
          id: 'al_b',
          invoiceId: 'inv_b',
          amountPaymentCurrency: '100.00',
          amountInvoiceCurrency: '100.00',
          amountUsd: '100.00',
        },
      ],
    });
    await seedExpense(db, {
      id: 'exp_a',
      categoryId,
      amount: '40.00',
      projectId: 'pry_a',
      accountId: 'acc_usd',
      accountAmount: '40.00',
    });
    for (const id of ['inv_a', 'inv_b', 'inv_ok']) await seed.projector.projectInvoice(id);
    await seed.projector.projectPayment('pay_b');
    await seed.projector.projectExpense('exp_a');
    await seed.projector.projectAccount('acc_usd');
    await seed.projector.projectClients(['cli_a', 'cli_b']);
    await seed.projector.projectProjects(['pry_a', 'pry_b']);
  });
  const doc = (id: string, expiresAt: string) =>
    admin.document.create({
      data: {
        id,
        code: id.toUpperCase(),
        title: id,
        typeId,
        status: 'FIRMADO',
        signedAt: new Date('2026-01-01'),
        expiresAt: new Date(expiresAt),
      },
    });
  await doc('doc_exp', '2026-10-28');
  await doc('doc_later', '2026-11-30');
  const link = (id: string, expiresAt: string | null) =>
    admin.shareLink.create({
      data: {
        id,
        token: id.padEnd(43, 'x'),
        title: id,
        createdById: user.id,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
  await link('shr_exp', '2026-10-28');
  await link('shr_open', '2026-12-31');
  await link('shr_never', null);
  await admin.recurringCharge.createMany({
    data: ['ACTIVO', 'PAUSADO'].map((status, index) => ({
      id: `rec_${index}`,
      projectId: 'pry_a',
      label: `Soporte ${status}`,
      amount: '100.00',
      currency: 'USD',
      frequency: 'MENSUAL' as const,
      startDate: new Date('2026-11-01'),
      billingDay: 5,
      leadDays: 7,
      status: status as 'ACTIVO' | 'PAUSADO',
      usdRate: '1',
      monthlyAmountUsd: '100.00',
    })),
  });
  const { categoryId } = await seed.uow.run(() => catalogIds(seed.host.db));
  await admin.recurringExpense.create({
    data: {
      id: 'rex_a',
      name: 'Hosting',
      categoryId,
      currency: 'USD',
      amount: '120.00',
      frequency: 'MENSUAL',
      dayOfPeriod: 1,
      leadDays: 0,
      startDate: new Date('2026-09-01'),
      usdRate: '1',
      monthlyAmountUsd: '120.00',
    },
  });
}
