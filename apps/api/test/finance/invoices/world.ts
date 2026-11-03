import { InvoiceSupport } from '../../../src/modules/finance/application/use-cases/invoices/invoice-support';
import { ArchiveInvoice } from '../../../src/modules/finance/application/use-cases/invoices/archive-invoice.use-case';
import { AttachInvoiceFile } from '../../../src/modules/finance/application/use-cases/invoices/attach-invoice-file.use-case';
import { CreateInvoice } from '../../../src/modules/finance/application/use-cases/invoices/create-invoice.use-case';
import {
  GetInvoice,
  ListInvoices,
} from '../../../src/modules/finance/application/use-cases/invoices/list-invoices.use-case';
import {
  ListBillableInstallments,
  ListOpenInvoices,
} from '../../../src/modules/finance/application/use-cases/invoices/invoice-wizard-reads.use-case';
import { MarkOverdueInvoices } from '../../../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { RecomputeInvoice } from '../../../src/modules/finance/application/use-cases/invoices/recompute-invoice.use-case';
import { RestoreInvoice } from '../../../src/modules/finance/application/use-cases/invoices/restore-invoice.use-case';
import { IssueDraft } from '../../../src/modules/finance/application/use-cases/invoices/issue-draft.use-case';
import { UpdateInvoice } from '../../../src/modules/finance/application/use-cases/invoices/update-invoice.use-case';
import { VoidInvoice } from '../../../src/modules/finance/application/use-cases/invoices/void-invoice.use-case';
import type { FinanceProjector } from '../../../src/modules/finance/application/finance-projector';
import type {
  InvoiceFilesPort,
  InvoiceFiscalPort,
  InvoiceReferencesPort,
} from '../../../src/modules/finance/application/ports/invoice-references.port';
import type { InvoiceInput } from '../../../src/modules/finance/application/use-cases/invoices/invoice-input';
import type {
  InvoiceLineRecord,
  InvoiceRecord,
} from '../../../src/modules/finance/application/ports/invoice.repository.port';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import { NotFoundError } from '../../../src/shared/domain/domain-error';
import type { EntityRef } from '../../../src/shared/domain/entity-ref';
import type { UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemorySearchIndex } from '../../support/fakes/in-memory-search-index';
import { InMemorySequence } from '../../support/fakes/in-memory-sequence';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { InMemoryInvoiceRepository } from './fakes/in-memory-invoice.repository';

/** 2026-10-09 in Caracas (the mock's "today"). */
export const NOW = '2026-10-09T15:00:00.000Z';

export const userOf = (role: UserRole): CurrentUser => ({
  userId: `usr_${role.toLowerCase()}`,
  clerkId: `user_${role.toLowerCase()}`,
  role,
  email: `${role.toLowerCase()}@example.test`,
  name: role,
});

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

export async function rejection(promise: Promise<unknown>): Promise<{
  code?: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
  entity?: EntityRef;
}> {
  try {
    await promise;
  } catch (error) {
    return error as {
      code?: string;
      message?: string;
      fieldErrors?: Record<string, string[]>;
      entity?: EntityRef;
    };
  }
  throw new Error('expected the promise to reject');
}

export const KAIROS = 'cli_kairos';
export const ZAFIRO = 'cli_zafiro';
export const GONE = 'cli_gone';
export const WEB = 'pry_web';
export const LABS = 'pry_labs';
export const WEB_1 = 'ins_web_1';
export const WEB_2 = 'ins_web_2';
export const CANCELLED = 'ins_cancelled';
export const LABS_1 = 'ins_labs_1';

/** The line of the seed invoice: 100.00 at 16 %. */
export const SEED_LINE: InvoiceLineRecord = {
  id: 'inl_seed',
  order: 0,
  description: 'Servicio',
  projectId: null,
  installmentId: null,
  quantity: '1',
  unitPrice: '100.00',
  amount: '100.00',
  discount: '0.00',
  netAmount: '100.00',
  ivaRate: '16',
};

/** A stored invoice (`EMITIDA`, 100.00 + 16 % IVA = 116.00 USD) the tests override field by field. */
export const invoiceRecord = (over: Partial<InvoiceRecord> = {}): InvoiceRecord => ({
  id: 'inv_seed',
  code: 'FAC-0100',
  clientId: KAIROS,
  invoiceNumber: 'KAI-0001',
  controlNumber: null,
  issueDate: '2026-10-01',
  dueDate: '2026-11-01',
  currency: 'USD',
  usdRate: '1',
  bcvRate: null,
  subtotal: '100.00',
  discount: '0.00',
  exemptAmount: '0.00',
  taxBase: '100.00',
  ivaAmount: '16.00',
  total: '116.00',
  ivaWithheld: '0.00',
  islrWithheld: '0.00',
  otherWithheld: '0.00',
  otherWithheldNote: null,
  receivable: '116.00',
  totalUsd: '116.00',
  receivableUsd: '116.00',
  paidAmount: '0.00',
  balance: '116.00',
  isDraft: false,
  status: 'EMITIDA',
  voidedAt: null,
  voidReason: null,
  fileId: null,
  lines: [SEED_LINE],
  taxLines: [{ ivaRate: '16', taxBase: '100.00', ivaAmount: '16.00' }],
  createdAt: NOW,
  updatedAt: NOW,
  createdById: null,
  updatedById: null,
  archivedAt: null,
  archivedById: null,
  ...over,
});

/** A valid create input (one 100.00 line at 16 %), overridden field by field. */
export function invoiceInput(over: Record<string, unknown> = {}): InvoiceInput {
  return {
    clientId: ZAFIRO,
    invoiceNumber: 'NEW-0001',
    issueDate: '2026-10-09',
    dueDate: '2026-11-08',
    currency: 'USD',
    usdRate: '1',
    lines: [{ description: 'Servicio de prueba', unitPrice: '100.00', ivaRate: '16' }],
    ...over,
  } as InvoiceInput;
}

/** Calls the projector in order, so a test can assert what a mutation recomputed. */
export class RecordingProjector {
  readonly calls: string[] = [];
  projectInvoice = async (id: string) => void this.calls.push(`invoice:${id}`);
  projectPayment = async (id: string) => void this.calls.push(`payment:${id}`);
  projectClients = async (ids: readonly string[]) =>
    void this.calls.push(`clients:${[...ids].sort().join(',')}`);
  projectProjects = async (ids: readonly string[]) =>
    void this.calls.push(`projects:${[...ids].sort().join(',')}`);
}

/** The invoice use cases over in-memory ports and the real permission matrix. */
export function createWorld() {
  const uow = new InMemoryUnitOfWork();
  const invoices = new InMemoryInvoiceRepository(uow);
  const activity = new InMemoryActivityLog(uow);
  const search = new InMemorySearchIndex(uow);
  const sequence = new InMemorySequence(uow);
  const locks = new InMemoryRowLocks(uow);
  const clock = new FixedClock(NOW);
  const ids = new SequentialIdGenerator('gen');
  const authorization = new MatrixAuthorization();
  const projector = new RecordingProjector();

  const clients = new Map<string, EntityRef>([
    [KAIROS, { type: 'CLIENT', id: KAIROS, code: 'CLI-0001', label: 'Kairos' }],
    [ZAFIRO, { type: 'CLIENT', id: ZAFIRO, code: 'CLI-0002', label: 'Zafiro Labs' }],
  ]);
  const projects = new Map<string, { ref: EntityRef; clients: string[] }>([
    [WEB, { ref: { type: 'PROJECT', id: WEB, label: 'Kairos Web' }, clients: [KAIROS] }],
    [LABS, { ref: { type: 'PROJECT', id: LABS, label: 'Zafiro App' }, clients: [ZAFIRO] }],
  ]);
  const references: InvoiceReferencesPort = {
    liveClient: async (id) => clients.get(id) ?? null,
    liveProject: async (id) => projects.get(id)?.ref ?? null,
    projectBelongsToClient: async (projectId, clientId) =>
      projects.get(projectId)?.clients.includes(clientId) ?? false,
    liveProjectsOfClient: async (clientId) =>
      [...projects.values()].filter((p) => p.clients.includes(clientId)).map((p) => p.ref),
  };
  const fiscal: InvoiceFiscalPort = { allowedIvaRates: async () => ['16', '8', '0'] };
  const knownFiles = new Map<string, { mimeType: string; sizeBytes: number }>([
    ['file_pdf', { mimeType: 'application/pdf', sizeBytes: 2048 }],
    ['file_txt', { mimeType: 'text/plain', sizeBytes: 10 }],
    ['file_big', { mimeType: 'application/pdf', sizeBytes: 10 * 1024 * 1024 + 1 }],
  ]);
  const reservedFiles: string[] = [];
  const files: InvoiceFilesPort = {
    reserve: async (_actor, fileId) => {
      if (fileId === 'file_boom') throw new Error('storage down');
      const file = knownFiles.get(fileId);
      if (!file) throw new NotFoundError();
      reservedFiles.push(fileId);
      return { id: fileId, ...file };
    },
  };
  const currencies = {
    knownCodes: async (codes: readonly string[]) =>
      new Set(codes.filter((code) => ['USD', 'VES', 'EUR'].includes(code))),
  };
  const recomputed: string[][] = [];
  const recomputeInstallments = {
    execute: async (installmentIds: readonly string[]) => {
      recomputed.push([...installmentIds].sort());
      return [];
    },
  };

  const support = new InvoiceSupport(
    invoices,
    references,
    fiscal,
    files,
    currencies,
    projector as unknown as FinanceProjector,
    recomputeInstallments,
    search,
    activity,
    clock,
    locks,
  );

  invoices.seedInstallment({
    id: WEB_1,
    projectId: WEB,
    label: 'Anticipo',
    currency: 'USD',
    amount: '4000.00',
    cancelled: false,
  });
  invoices.seedInstallment({
    id: WEB_2,
    projectId: WEB,
    label: 'Hito de diseño',
    currency: 'USD',
    amount: '3000.00',
    cancelled: false,
  });
  invoices.seedInstallment({
    id: CANCELLED,
    projectId: WEB,
    label: 'Cancelada',
    currency: 'USD',
    amount: '500.00',
    cancelled: true,
  });
  invoices.seedInstallment({
    id: LABS_1,
    projectId: LABS,
    label: 'Zafiro 1',
    currency: 'VES',
    amount: '1000.00',
    cancelled: false,
  });

  return {
    uow,
    invoices,
    activity,
    search,
    locks,
    clock,
    projector,
    recomputed,
    reservedFiles,
    clients,
    projects,
    owner: userOf('OWNER'),
    admin: userOf('ADMIN'),
    member: userOf('MEMBER'),
    viewer: userOf('VIEWER'),
    list: new ListInvoices(authorization, invoices, clock),
    get: new GetInvoice(authorization, invoices, clock),
    create: new CreateInvoice(authorization, uow, support, sequence, ids),
    update: new UpdateInvoice(authorization, uow, support, ids),
    issueDraft: new IssueDraft(authorization, uow, support),
    voidInvoice: new VoidInvoice(authorization, uow, support),
    archive: new ArchiveInvoice(authorization, uow, support),
    restore: new RestoreInvoice(authorization, uow, support),
    attachFile: new AttachInvoiceFile(authorization, uow, support),
    listBillable: new ListBillableInstallments(authorization, invoices, references),
    listOpen: new ListOpenInvoices(authorization, invoices, references),
    recompute: new RecomputeInvoice(support),
    markOverdue: new MarkOverdueInvoices(uow, invoices, support, clock),
  };
}

export type World = ReturnType<typeof createWorld>;
