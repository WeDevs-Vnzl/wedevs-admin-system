import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { createTestPrisma } from '../support/db';

let prisma: PrismaClient;
let indexes: { tablename: string; indexname: string; indexdef: string }[];

beforeAll(async () => {
  prisma = createTestPrisma();
  indexes =
    await prisma.$queryRaw`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'`;
});

afterAll(async () => {
  await prisma.$disconnect();
});

// [table, index name from the complementary migration]
const NAMED: readonly (readonly [string, string])[] = [
  ['Invoice', 'inv_open'],
  ['Invoice', 'inv_client_issue'],
  ['InvoiceLine', 'invline_project_cover'],
  ['Payment', 'pay_status_date'],
  ['Payment', 'pay_unallocated'],
  ['Payment', 'pay_pending'],
  ['Expense', 'exp_status_paid'],
  ['Expense', 'exp_category_date'],
  ['Expense', 'exp_account_date'],
  ['Expense', 'exp_recurring_pending'],
  ['AccountTransfer', 'transfer_from_date'],
  ['AccountTransfer', 'transfer_to_date'],
  ['AccountMovement', 'movement_account_date'],
  ['BillingInstallment', 'inst_pending'],
  ['Document', 'doc_expiring'],
  ['Document', 'doc_status_updated'],
  ['Document', 'doc_type'],
  ['RecurringExpense', 're_active'],
  ['DocumentLink', 'doclink_contact'],
  ['DocumentLink', 'doclink_payment'],
  ['DocumentLink', 'doclink_expense'],
  ['NoteLink', 'notelink_contact'],
  ['NoteLink', 'notelink_invoice'],
  ['NoteLink', 'notelink_payment'],
  ['NoteLink', 'notelink_expense'],
  ['TagAssignment', 'tag_client'],
  ['TagAssignment', 'tag_contact'],
  ['TagAssignment', 'tag_project'],
  ['TagAssignment', 'tag_invoice'],
  ['TagAssignment', 'tag_payment'],
  ['TagAssignment', 'tag_expense'],
  ['TagAssignment', 'tag_document'],
  ['TagAssignment', 'tag_note'],
  ['Client', 'client_status_created'],
  ['Client', 'client_activated'],
  ['Project', 'project_status_target'],
  ['Project', 'project_start'],
  ['Project', 'project_end'],
  ['ClientMetrics', 'cm_overdue'],
];

// [table, column fragments that must all appear in the index definition] — owned by schema.prisma
const SCHEMA: readonly (readonly [string, readonly string[]])[] = [
  ['ActivityLog', ['actorType', 'createdAt']],
  ['ActivityLog', ['clientId', 'DESC']],
  ['SearchEntry', ['entityType', 'archived']],
  ['AccountReconciliation', ['accountId', 'date']],
  ['RecurringCharge', ['projectId']],
  ['FinanceFact', ['kind', 'date']],
  ['FinanceFact', ['clientId', 'kind', 'date']],
  ['FinanceFact', ['projectId', 'kind', 'date']],
  ['FinanceFact', ['accountId', 'date']],
  ['FinanceFact', ['invoiceId']],
  ['FinanceFact', ['sourceType', 'sourceId']],
  ['ClientMetrics', ['receivableUsd']],
  ['ClientMetrics', ['lastActivityAt']],
  ['ProjectMetrics', ['toInvoiceUsd']],
  ['ShareAccessLog', ['shareLinkId', 'documentId', 'ipHash', 'createdAt']],
];

describe('data-rules §3b query indexes', () => {
  it.each(NAMED)('%s has index %s', (table, name) => {
    expect(indexes.find((i) => i.tablename === table && i.indexname === name)).toBeDefined();
  });

  it.each(SCHEMA)('%s has a schema index on %j', (table, fragments) => {
    const found = indexes.some(
      (i) => i.tablename === table && fragments.every((f) => i.indexdef.includes(f)),
    );
    expect(found).toBe(true);
  });

  it('the partial indexes carry their predicates', () => {
    const def = (name: string) => indexes.find((i) => i.indexname === name)?.indexdef ?? '';
    expect(def('inv_open')).toMatch(/isDraft/);
    expect(def('pay_unallocated')).toMatch(/unallocated/);
    expect(def('exp_recurring_pending')).toMatch(/recurringExpenseId/);
    expect(def('invline_project_cover')).toMatch(/INCLUDE/);
    expect(def('cm_overdue')).toMatch(/overdueUsd/);
    expect(def('re_active')).toMatch(/startDate/);
    expect(def('re_active')).toMatch(/ACTIVO/);
    expect(def('inv_open')).toMatch(/EMITIDA/);
    expect(def('inv_open')).toMatch(/PARCIAL/);
    expect(def('inv_open')).toMatch(/VENCIDA/);
    expect(def('inv_open')).toMatch(/NOT "isDraft"/);
    expect(def('inv_open')).toMatch(/"deletedAt" IS NULL/);
  });

  it('has no Document category index and no RecurringExpense nextDueDate index (DT-107)', () => {
    expect(
      indexes.some((i) => i.tablename === 'Document' && i.indexdef.includes('categoryId')),
    ).toBe(false);
    expect(
      indexes.some((i) => i.tablename === 'RecurringExpense' && i.indexdef.includes('nextDueDate')),
    ).toBe(false);
  });
});
