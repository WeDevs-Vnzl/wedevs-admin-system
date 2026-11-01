import type { PrismaClient } from '../../../src/generated/prisma/client';
import {
  makeAccount,
  makeClient,
  makeContact,
  makeDocument,
  makeExpense,
  makeInvoice,
  makePayment,
  makeProject,
  makeTag,
  uid,
} from '../../db/helpers';

const ARCHIVED_AT = new Date('2026-09-01T12:00:00.000Z');

/** A small studio with one record of every node type, linked as PRD §8.12.3 lists. */
export async function seedStudio(db: PrismaClient) {
  const kairos = await makeClient(db);
  const mochima = await makeClient(db);
  await db.clientMetrics.create({ data: { clientId: kairos.id, receivableUsd: '120.5' } });

  const contact = await makeContact(db, kairos.id);
  const archivedContact = await makeContact(db, kairos.id, false, true);

  const app = await makeProject(db);
  const erp = await makeProject(db);
  await db.project.update({
    where: { id: app.id },
    data: { status: 'EN_CURSO', startDate: new Date('2026-07-05') },
  });
  await db.projectClient.createMany({
    data: [
      { projectId: app.id, clientId: kairos.id, role: 'Dueño' },
      { projectId: app.id, clientId: mochima.id },
      { projectId: erp.id, clientId: kairos.id },
    ],
  });
  const stack = await Promise.all(
    ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].map((name) =>
      db.technology.create({
        data: {
          name: `${name}-${uid('t')}`,
          slug: uid('slug'),
          category: 'FRONTEND',
          iconSlug: name === 'Beta' ? null : `icon-${name.toLowerCase()}`,
        },
      }),
    ),
  );
  await db.projectTechnology.createMany({
    data: stack.map((tech) => ({ projectId: app.id, technologyId: tech.id })),
  });

  const account = await makeAccount(db);
  const invoice = await makeInvoice(db, kairos.id);
  await db.invoiceLine.create({
    data: {
      invoiceId: invoice.id,
      projectId: app.id,
      description: 'Work',
      unitPrice: '100',
      amount: '100',
      netAmount: '100',
    },
  });
  const payment = await makePayment(db, kairos.id, account.id, { amount: '116' });
  await db.paymentAllocation.createMany({
    data: [
      {
        paymentId: payment.id,
        invoiceId: invoice.id,
        amountPaymentCurrency: '116',
        amountInvoiceCurrency: '116',
        amountUsd: '116',
      },
    ],
  });
  const expense = await makeExpense(db, account.id);
  await db.expense.update({ where: { id: expense.id }, data: { projectId: app.id } });

  const document = await makeDocument(db);
  await db.documentLink.createMany({
    data: [
      { documentId: document.id, clientId: kairos.id },
      { documentId: document.id, projectId: app.id },
    ],
  });
  const author = await db.user.create({
    data: { clerkId: uid('clerk'), email: `${uid('u')}@example.test`, name: 'Ana Autora' },
  });
  const note = await db.note.create({
    data: {
      content: {},
      contentText: 'Llamada con el cliente sobre el alcance',
      authorId: author.id,
    },
  });
  await db.noteLink.create({ data: { noteId: note.id, clientId: kairos.id } });

  const tag = await makeTag(db);
  await db.tagAssignment.createMany({
    data: [
      { tagId: tag.id, clientId: kairos.id },
      { tagId: tag.id, projectId: app.id },
    ],
  });

  return {
    kairos,
    mochima,
    contact,
    archivedContact,
    app,
    erp,
    stack,
    account,
    invoice,
    payment,
    expense,
    document,
    note,
    author,
    tag,
    archivedAt: ARCHIVED_AT,
  };
}

export type Studio = Awaited<ReturnType<typeof seedStudio>>;
