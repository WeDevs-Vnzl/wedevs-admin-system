import type { PrismaClient } from '../../../src/generated/prisma/client';
import { dateOnlyToDbDate } from '../../../src/shared/infrastructure/prisma/decimal-mapper';
import {
  catalogIds,
  seedAccount,
  seedClient,
  seedExpense,
  seedInvoice,
  seedPayment,
  seedProject,
  type World,
} from '../../finance/read-models/world';

/**
 * A small studio with real source rows and the facts the real projector derives from them, so a report is
 * checked against the figures this file adds up by hand (the comments).
 *
 *  cli_a "Kairos" (tag_a), pry_a   cli_b "Zafiro", pry_b (tag_p)   deleted: cli_gone, pry_dead
 *  Sep: inv2 cli_b/pry_b 500 + 8 % IVA 40 = 540 USD, due Sep 25, paid 100 on Sep 12
 *  Oct: inv1 cli_a/pry_a 1,000 + 16 % IVA 160 = 1,160 USD, IVA withheld 20, due Oct 20, paid 250 on Oct 2 (IGTF 3)
 *       inv3 cli_a/pry_a VES at 36: 3,600 @16 % + 720 @0 % = 4,896 VES = 136.00 USD, due Nov 5
 *  Expenses paid: Oct 3 50 (pry_a, root category), Sep 5 20 (child category, no project)
 *  Account activity on acc_usd in Sep: transfer out 30, movement in 200, adjustment -15, movement out 40
 */
export async function seedReportsStudio(world: World, admin: PrismaClient) {
  const { methodId } = await catalogIds(world.host.db);
  // `ecat_hosting` is a child of the root `ecat_infraestructura`; `cat-child` hangs one level below it.
  const categoryId = 'ecat_hosting';
  const rootCategoryId = 'ecat_infraestructura';
  await world.uow.run(async () => {
    const db = world.host.db;
    await seedClient(db, 'cli_a');
    await seedClient(db, 'cli_b');
    await seedClient(db, 'cli_gone');
    await seedProject(db, 'pry_a', ['cli_a']);
    await seedProject(db, 'pry_b', ['cli_b']);
    await seedProject(db, 'pry_dead', ['cli_a']);
    await seedAccount(db, 'acc_usd', 'USD');
    await seedAccount(db, 'acc_ves', 'VES');
    await seedAccount(db, 'acc_off', 'USD');
    await seedAccount(db, 'acc_del', 'USD');
    await db.expenseCategory.create({
      data: { id: 'cat-child', name: 'Child', parentId: categoryId },
    });

    await seedInvoice(db, {
      id: 'inv_1',
      clientId: 'cli_a',
      issueDate: '2026-10-01',
      dueDate: '2026-10-20',
      ivaWithheld: '20.00',
      lines: [{ id: 'l1', projectId: 'pry_a', unitPrice: '1000.00', ivaRate: '16' }],
    });
    await seedInvoice(db, {
      id: 'inv_2',
      clientId: 'cli_b',
      issueDate: '2026-09-10',
      dueDate: '2026-09-25',
      lines: [{ id: 'l2', projectId: 'pry_b', unitPrice: '500.00', ivaRate: '8' }],
    });
    await seedInvoice(db, {
      id: 'inv_3',
      clientId: 'cli_a',
      currency: 'VES',
      usdRate: '36',
      issueDate: '2026-10-05',
      dueDate: '2026-11-05',
      lines: [
        { id: 'l3', projectId: 'pry_a', unitPrice: '3600.00', ivaRate: '16' },
        { id: 'l4', projectId: 'pry_a', unitPrice: '720.00', ivaRate: '0' },
      ],
    });
    // Draft, voided and archived invoices produce no facts.
    await seedInvoice(db, {
      id: 'inv_draft',
      clientId: 'cli_a',
      status: 'BORRADOR',
      issueDate: '2026-10-02',
      lines: [{ id: 'l5', projectId: 'pry_a', unitPrice: '999.00', ivaRate: '16' }],
    });
    await seedInvoice(db, {
      id: 'inv_void',
      clientId: 'cli_a',
      status: 'ANULADA',
      issueDate: '2026-10-02',
      lines: [{ id: 'l6', projectId: 'pry_a', unitPrice: '999.00', ivaRate: '16' }],
    });
    await seedInvoice(db, {
      id: 'inv_arch',
      clientId: 'cli_a',
      archived: true,
      issueDate: '2026-10-02',
      lines: [{ id: 'l7', projectId: 'pry_a', unitPrice: '999.00', ivaRate: '16' }],
    });

    await seedPayment(db, {
      id: 'pay_1',
      clientId: 'cli_a',
      accountId: 'acc_usd',
      methodId,
      amount: '253.00',
      igtfAmount: '3.00',
      date: '2026-10-02',
      allocations: [
        {
          id: 'al_1',
          invoiceId: 'inv_1',
          amountPaymentCurrency: '250.00',
          amountInvoiceCurrency: '250.00',
          amountUsd: '250.00',
        },
      ],
    });
    await seedPayment(db, {
      id: 'pay_2',
      clientId: 'cli_b',
      accountId: 'acc_usd',
      methodId,
      amount: '100.00',
      date: '2026-09-12',
      allocations: [
        {
          id: 'al_2',
          invoiceId: 'inv_2',
          amountPaymentCurrency: '100.00',
          amountInvoiceCurrency: '100.00',
          amountUsd: '100.00',
        },
      ],
    });
    await seedPayment(db, {
      id: 'pay_pending',
      clientId: 'cli_a',
      accountId: 'acc_usd',
      methodId,
      amount: '77.00',
      status: 'PENDIENTE_VERIFICACION',
      date: '2026-10-03',
    });

    await seedExpense(db, {
      id: 'exp_1',
      categoryId,
      amount: '50.00',
      accountId: 'acc_usd',
      projectId: 'pry_a',
      date: '2026-10-03',
      paidAt: '2026-10-03',
    });
    await seedExpense(db, {
      id: 'exp_2',
      categoryId: 'cat-child',
      amount: '20.00',
      accountId: 'acc_usd',
      date: '2026-09-05',
      paidAt: '2026-09-05',
    });
    await seedExpense(db, {
      id: 'exp_pending',
      categoryId,
      amount: '999.00',
      status: 'PENDIENTE',
      date: '2026-10-04',
    });

    for (const id of ['inv_1', 'inv_2', 'inv_3', 'inv_draft', 'inv_void', 'inv_arch']) {
      await world.projector.projectInvoice(id);
    }
    for (const id of ['pay_1', 'pay_2', 'pay_pending']) await world.projector.projectPayment(id);
    for (const id of ['exp_1', 'exp_2', 'exp_pending']) await world.projector.projectExpense(id);
  });

  // Transfers and movements: the facts a transfer and a movement leave on the account.
  const fact = (
    kind: 'TRANSFER_OUT' | 'TRANSFER_IN' | 'MOVEMENT_IN' | 'MOVEMENT_OUT',
    date: string,
    amountUsd: string,
    accountId: string,
    n: number,
  ) =>
    admin.financeFact.create({
      data: {
        kind,
        date: dateOnlyToDbDate(date),
        amountUsd,
        accountId,
        sourceType: kind.startsWith('TRANSFER') ? 'TRANSFER' : 'MOVEMENT',
        sourceId: `src_${n}`,
      },
    });
  await fact('TRANSFER_OUT', '2026-09-20', '30.00', 'acc_usd', 1);
  await fact('TRANSFER_IN', '2026-09-20', '30.00', 'acc_ves', 1);
  await fact('MOVEMENT_IN', '2026-09-21', '200.00', 'acc_usd', 2);
  await fact('MOVEMENT_IN', '2026-09-22', '-15.00', 'acc_usd', 3);
  await fact('MOVEMENT_OUT', '2026-09-23', '40.00', 'acc_usd', 4);

  // Names, tags, deletions, balances and the rest of what the KPIs read.
  await admin.client.update({ where: { id: 'cli_a' }, data: { tradeName: 'Kairos' } });
  await admin.client.update({ where: { id: 'cli_b' }, data: { tradeName: 'Zafiro' } });
  await admin.client.update({
    where: { id: 'cli_gone' },
    data: { deletedAt: new Date('2026-08-01') },
  });
  await admin.project.update({
    where: { id: 'pry_dead' },
    data: { deletedAt: new Date('2026-08-01') },
  });
  await admin.tag.create({ data: { id: 'tag_a', name: 'tag-a', color: '#111111' } });
  await admin.tag.create({ data: { id: 'tag_p', name: 'tag-p', color: '#222222' } });
  await admin.tagAssignment.create({ data: { tagId: 'tag_a', clientId: 'cli_a' } });
  await admin.tagAssignment.create({ data: { tagId: 'tag_p', projectId: 'pry_b' } });
  await admin.account.update({ where: { id: 'acc_usd' }, data: { balance: '1000.00' } });
  await admin.account.update({ where: { id: 'acc_ves' }, data: { balance: '3600.00' } });
  await admin.account.update({
    where: { id: 'acc_off' },
    data: { balance: '5.00', active: false },
  });
  await admin.account.update({
    where: { id: 'acc_del' },
    data: { balance: '7.00', deletedAt: new Date('2026-08-01') },
  });

  // Caracas is UTC-4: 02:00Z on Oct 2 is the evening of Oct 1.
  await admin.client.update({
    where: { id: 'cli_a' },
    data: {
      createdAt: new Date('2026-10-02T02:00:00.000Z'),
      activatedAt: new Date('2026-10-04T03:00:00.000Z'),
    },
  });
  await admin.client.update({
    where: { id: 'cli_b' },
    data: { createdAt: new Date('2026-08-15T16:00:00.000Z') },
  });

  await admin.project.update({
    where: { id: 'pry_a' },
    data: {
      status: 'EN_CURSO',
      startDate: dateOnlyToDbDate('2026-10-02'),
      targetEndDate: dateOnlyToDbDate('2026-12-01'),
    },
  });
  await admin.project.update({
    where: { id: 'pry_b' },
    data: {
      status: 'ENTREGADO',
      startDate: dateOnlyToDbDate('2026-08-01'),
      targetEndDate: dateOnlyToDbDate('2026-09-01'),
      endDate: dateOnlyToDbDate('2026-09-10'),
    },
  });
  await admin.billingPlan.create({
    data: { projectId: 'pry_a', model: 'PRECIO_FIJO', currency: 'USD', contractedUsd: '3000.00' },
  });
  const technologies = await admin.technology.findMany({ orderBy: { slug: 'asc' }, take: 2 });
  for (const technology of technologies) {
    await admin.projectTechnology.create({
      data: { projectId: 'pry_a', technologyId: technology.id },
    });
  }

  const document = (
    id: string,
    typeId: string,
    status: 'FIRMADO' | 'VENCIDO',
    expiresAt?: string,
  ) =>
    admin.document.create({
      data: {
        id,
        code: id,
        title: id,
        typeId,
        status,
        expiresAt: expiresAt ? dateOnlyToDbDate(expiresAt) : null,
      },
    });
  await document('doc_contract', 'dtyp_contrato_servicios', 'FIRMADO');
  await document('doc_nda', 'dtyp_nda', 'FIRMADO', '2026-10-01');
  await document('doc_nda_void', 'dtyp_nda', 'VENCIDO', '2027-01-01');
  await document('doc_contract_deleted', 'dtyp_contrato_servicios', 'FIRMADO');
  await admin.document.update({
    where: { id: 'doc_contract_deleted' },
    data: { deletedAt: new Date('2026-08-01') },
  });
  await admin.documentLink.create({ data: { documentId: 'doc_contract', clientId: 'cli_a' } });
  await admin.documentLink.create({ data: { documentId: 'doc_nda', projectId: 'pry_a' } });
  await admin.documentLink.create({ data: { documentId: 'doc_nda_void', projectId: 'pry_a' } });
  await admin.documentLink.create({
    data: { documentId: 'doc_contract_deleted', projectId: 'pry_a' },
  });

  const charge = (projectId: string, monthlyAmountUsd: string, extra: object = {}) =>
    admin.recurringCharge.create({
      data: {
        projectId,
        label: 'Hosting',
        amount: monthlyAmountUsd,
        currency: 'USD',
        frequency: 'MENSUAL',
        startDate: dateOnlyToDbDate('2026-01-01'),
        billingDay: 1,
        usdRate: '1',
        monthlyAmountUsd,
        ...extra,
      },
    });
  await charge('pry_a', '100.00');
  await charge('pry_b', '50.00', { endDate: dateOnlyToDbDate('2026-09-15') });
  await charge('pry_dead', '999.00');

  const template = (name: string, monthlyAmountUsd: string, extra: object = {}) =>
    admin.recurringExpense.create({
      data: {
        name,
        categoryId,
        currency: 'USD',
        amount: monthlyAmountUsd,
        frequency: 'MENSUAL',
        dayOfPeriod: 1,
        startDate: dateOnlyToDbDate('2026-01-01'),
        usdRate: '1',
        monthlyAmountUsd,
        ...extra,
      },
    });
  await template('with-project', '30.00', { projectId: 'pry_a' });
  await template('no-project', '12.50');
  await template('deleted', '99.00', { deletedAt: new Date('2026-08-01') });

  return { methodId, categoryId, rootCategoryId, technologyIds: technologies.map((t) => t.id) };
}
