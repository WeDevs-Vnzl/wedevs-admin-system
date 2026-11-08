// MOCK: fictional pilot demo data for a LOCAL database only (data-rules §9, C5). Every name, tax id, account
// identifier and amount below is invented; nothing here is real customer or banking data.
/**
 * Pilot demo seed. `bun run db:seed:demo` WIPES the business data of the target database, keeps the users
 * (`User`, `UserPreference`) and the catalogs, re-seeds the catalogs and rebuilds a small, coherent data set
 * through the application use cases (so activity, metrics, finance facts, search entries, sequences and
 * account balances are written by the domain, never by raw SQL).
 *
 * Localhost only: unlike `seed.ts`, `--allow-remote` is never accepted. Needs an active OWNER user: sign the
 * Owner in once before running it. The database URL is never printed.
 */
import 'dotenv/config';
import 'reflect-metadata';
import { Module, type INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaPg } from '@prisma/adapter-pg';
import { AppModule } from '../src/app.module';
import { CreateClient } from '../src/modules/commercial/application/use-cases/create-client.use-case';
import { CreateContact } from '../src/modules/commercial/application/use-cases/create-contact.use-case';
import { CreateNote } from '../src/modules/commercial/application/use-cases/create-note.use-case';
import { CreateProject } from '../src/modules/commercial/application/use-cases/create-project.use-case';
import { SetClientStatus } from '../src/modules/commercial/application/use-cases/set-client-status.use-case';
import { CreateDocument } from '../src/modules/documents/application/use-cases/records/create-document.use-case';
import { CreateShareLink } from '../src/modules/documents/application/use-cases/shares/create-share-link.use-case';
import { PublishVersion } from '../src/modules/documents/application/use-cases/versions/publish-version.use-case';
import { SaveDraft } from '../src/modules/documents/application/use-cases/versions/save-draft.use-case';
import { CreateAccount } from '../src/modules/finance/application/use-cases/accounts/create-account.use-case';
import { CreateMovement } from '../src/modules/finance/application/use-cases/accounts/create-movement.use-case';
import { CreateInstallment } from '../src/modules/finance/application/use-cases/billing/create-installment.use-case';
import { CreateRecurringCharge } from '../src/modules/finance/application/use-cases/billing/create-recurring-charge.use-case';
import { UpsertBillingPlan } from '../src/modules/finance/application/use-cases/billing/upsert-billing-plan.use-case';
import { CreateExpense } from '../src/modules/finance/application/use-cases/expenses/create-expense.use-case';
import { CreateRecurringExpense } from '../src/modules/finance/application/use-cases/expenses/recurring-expense.use-cases';
import { CreateInvoice } from '../src/modules/finance/application/use-cases/invoices/create-invoice.use-case';
import { IssueDraft } from '../src/modules/finance/application/use-cases/invoices/issue-draft.use-case';
import { MarkOverdueInvoices } from '../src/modules/finance/application/use-cases/invoices/mark-overdue-invoices.use-case';
import { AllocatePayment } from '../src/modules/finance/application/use-cases/payments/allocate-payment.use-case';
import { CreatePayment } from '../src/modules/finance/application/use-cases/payments/create-payment.use-case';
import { UpsertExchangeRate } from '../src/modules/finance/application/use-cases/rates/upsert-exchange-rate.use-case';
import { CreateTag } from '../src/modules/settings/application/use-cases/create-tag.use-case';
import { SYSTEM_ACTOR } from '../src/shared/application/actor';
import type { CurrentUser } from '../src/shared/application/current-user';
import { addDays, todayInCaracas, type DateOnly } from '../src/shared/domain/business-date';
import type { RichTextDoc } from '../src/shared/domain/rich-text';
import { PrismaService } from '../src/shared/infrastructure/prisma/prisma.service';
import { PrismaClient } from '../src/generated/prisma/client';
import { assertSeedTarget, seedCatalogs, SeedTargetError } from './seed';

/** Tables the wipe keeps: Prisma's history, the catalogs and settings (`test/support/db.ts`), and the users. */
const KEPT_TABLES = new Set([
  '_prisma_migrations',
  'Currency',
  'PaymentMethod',
  'DocumentCategory',
  'DocumentType',
  'ExpenseCategory',
  'Technology',
  'Setting',
  'Sequence',
  'User',
  'UserPreference',
]);

/** The wipe needs an active OWNER to create the demo data as; refused before anything is deleted. */
export class NoOwnerError extends SeedTargetError {
  override name = 'NoOwnerError';
  constructor() {
    super(
      'No active OWNER user found: sign in with the Owner account once, then run the seed again',
    );
  }
}

/** The demo seed is local only: `--allow-remote` is never honoured, a non-local host is always refused. */
export function assertDemoSeedTarget(url: string | undefined, argv: readonly string[]): string {
  if (argv.includes('--allow-remote')) {
    throw new SeedTargetError('The demo seed is local only: --allow-remote is not accepted');
  }
  return assertSeedTarget(url, []);
}

/**
 * Empties every business table (all but the kept ones) with `RESTART IDENTITY CASCADE`, resets the sequences
 * to 0 and drops the `integrations.*` settings. Users are kept: their count is asserted unchanged.
 */
export async function wipeBusinessData(prisma: PrismaClient): Promise<void> {
  const owner = await prisma.user.findFirst({ where: { role: 'OWNER', deletedAt: null } });
  if (!owner) throw new NoOwnerError();
  const usersBefore = await prisma.user.count();

  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'`;
  const tables = rows.map((r) => r.tablename).filter((t) => !KEPT_TABLES.has(t));
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.replaceAll('"', '""')}"`).join(', ');
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  await prisma.sequence.updateMany({ data: { value: 0 } });
  await prisma.setting.deleteMany({ where: { key: { startsWith: 'integrations.' } } });

  if ((await prisma.user.count()) !== usersBefore) {
    throw new Error('The wipe changed the number of users: aborting');
  }
}

const doc = (...paragraphs: string[]): RichTextDoc => ({
  type: 'doc',
  content: paragraphs.map((text) => ({ type: 'paragraph', content: [{ type: 'text', text }] })),
});

/** Creates the demo data set through the use cases, as the OWNER. Needs the catalogs already seeded. */
export async function seedDemo(app: INestApplicationContext): Promise<void> {
  const db = app.get(PrismaService).client;
  const ownerRow = await db.user.findFirst({ where: { role: 'OWNER', deletedAt: null } });
  if (!ownerRow) throw new NoOwnerError();
  const owner: CurrentUser = {
    userId: ownerRow.id,
    clerkId: ownerRow.clerkId,
    role: 'OWNER',
    email: ownerRow.email,
    name: ownerRow.name,
  };

  const today = todayInCaracas(new Date());
  const day = (offset: number): DateOnly => addDays(today, offset);

  // Catalog ids (read only).
  const tech = async (slugs: string[]) =>
    (await db.technology.findMany({ where: { slug: { in: slugs } } })).map((t) => t.id);
  const method = async (code: string) =>
    (await db.paymentMethod.findFirstOrThrow({ where: { code } })).id;
  const typeId = (key: string) => `dtyp_${key}`;

  // ── Tags ──────────────────────────────────────────────────────────────────
  const createTag = app.get(CreateTag);
  const tags = new Map<string, string>();
  const tagId = (key: string): string => {
    const id = tags.get(key);
    if (!id) throw new Error(`Unknown demo tag: ${key}`);
    return id;
  };
  for (const [key, name, color] of [
    ['vip', 'VIP', '#b45309'],
    ['gov', 'Gobierno', '#0369a1'],
    ['startup', 'Startup', '#6d28d9'],
    ['prio', 'Prioridad', '#be123c'],
  ] as const) {
    tags.set(key, (await createTag.execute(owner, { name, color })).id);
  }

  // ── Clients and contacts ─────────────────────────────────────────────────
  const createClient = app.get(CreateClient);
  const createContact = app.get(CreateContact);
  const setStatus = app.get(SetClientStatus);
  const client = async (
    input: Parameters<CreateClient['execute']>[1],
    contacts: Omit<Parameters<CreateContact['execute']>[1], 'clientId'>[],
    active: boolean,
  ) => {
    const { client: row } = await createClient.execute(owner, input);
    for (const contact of contacts) {
      await createContact.execute(owner, { ...contact, clientId: row.id });
    }
    if (active) await setStatus.execute(owner, { id: row.id, status: 'ACTIVO' });
    return row.id;
  };

  const caribe = await client(
    {
      kind: 'EMPRESA',
      tradeName: 'Inversiones Caribe',
      legalName: 'Inversiones Caribe C.A.',
      taxId: 'J-31245678-9',
      country: 'VE',
      address: 'Av. Francisco de Miranda, Torre Demo, Piso 4, Caracas',
      phone: '+582125550101',
      email: 'contacto@caribe.example.test',
      website: 'https://caribe.example.test',
      tagIds: [tagId('vip'), tagId('prio')],
    },
    [
      {
        fullName: 'Luis Peña',
        position: 'Gerente General',
        email: 'luis@caribe.example.test',
        phone: '+584125550111',
        isPrimary: true,
      },
      { fullName: 'Andrea Salas', position: 'Administración', email: 'andrea@caribe.example.test' },
    ],
    true,
  );
  const brightwave = await client(
    {
      kind: 'EMPRESA',
      tradeName: 'Brightwave Labs',
      legalName: 'Brightwave Labs LLC',
      taxId: '98-7654321',
      country: 'US',
      address: '100 Demo Street, Suite 200, Miami, FL 33101',
      phone: '+13055550102',
      email: 'hello@brightwave.example.test',
      website: 'https://brightwave.example.test',
      tagIds: [tagId('startup')],
    },
    [
      {
        fullName: 'Emily Carter',
        position: 'CEO',
        email: 'emily@brightwave.example.test',
        isPrimary: true,
      },
      { fullName: 'Daniel Ruiz', position: 'Product Lead', phone: '+13055550113' },
    ],
    true,
  );
  const maria = await client(
    {
      kind: 'PERSONA',
      tradeName: 'María Fernanda Rojas',
      taxId: 'V-12345678-9',
      country: 'VE',
      address: 'Calle 5, Urb. Los Samanes, Valencia',
      phone: '+584245550103',
      email: 'maria@example.test',
      tagIds: [tagId('gov')],
    },
    [
      {
        fullName: 'María Fernanda Rojas',
        email: 'maria@example.test',
        phone: '+584245550103',
        isPrimary: true,
      },
    ],
    true,
  );
  await client(
    {
      kind: 'PERSONA',
      tradeName: 'Carlos Méndez',
      taxId: 'CC-1020304050',
      country: 'CO',
      address: 'Carrera 7 # 45-10, Bogotá',
      phone: '+573105550104',
      email: 'carlos@example.test',
      tagIds: [tagId('prio')],
    },
    [{ fullName: 'Carlos Méndez', email: 'carlos@example.test', isPrimary: true }],
    false, // stays PROSPECTO
  );

  // ── Projects ─────────────────────────────────────────────────────────────
  const createProject = app.get(CreateProject);
  const pedidos = (
    await createProject.execute(owner, {
      name: 'Plataforma de pedidos online',
      summary: 'Portal de pedidos y seguimiento para la red de distribución de Inversiones Caribe.',
      description: doc('Portal web con catálogo, carrito y panel de seguimiento.'),
      status: 'EN_CURSO',
      startDate: day(-70),
      targetEndDate: day(45),
      clients: [{ clientId: caribe, role: 'Cliente principal' }],
      technologyIds: await tech(['nextdotjs', 'nestjs', 'postgresql', 'typescript']),
      tagIds: [tagId('prio')],
      links: [
        {
          group: 'REPOSITORIO',
          label: 'Repositorio',
          url: 'https://github.com/example/pedidos-demo',
          order: 0,
        },
        {
          group: 'ENTORNO',
          label: 'Staging',
          url: 'https://staging.pedidos.example.test',
          order: 1,
        },
      ],
    })
  ).id;
  const rediseno = (
    await createProject.execute(owner, {
      name: 'Rediseño web Brightwave',
      summary: 'Propuesta de rediseño del sitio corporativo y del blog.',
      status: 'PROPUESTA',
      targetEndDate: day(90),
      clients: [{ clientId: brightwave, role: 'Patrocinador' }],
      technologyIds: await tech(['react', 'tailwindcss']),
      tagIds: [tagId('startup')],
      links: [
        {
          group: 'DISENO',
          label: 'Maqueta en Figma',
          url: 'https://figma.example.test/brightwave',
          order: 0,
        },
      ],
    })
  ).id;
  const reservas = (
    await createProject.execute(owner, {
      name: 'Landing de reservas',
      summary: 'Landing con formulario de reservas, entregada y en mantenimiento mensual.',
      status: 'ENTREGADO',
      startDate: day(-200),
      targetEndDate: day(-40),
      endDate: day(-30),
      clients: [{ clientId: maria }],
      technologyIds: await tech(['nextdotjs', 'tailwindcss']),
      tagIds: [],
      links: [
        { group: 'ENTORNO', label: 'Producción', url: 'https://reservas.example.test', order: 0 },
      ],
    })
  ).id;

  // ── Exchange rates (VES per USD, BCV) ────────────────────────────────────
  const upsertRate = app.get(UpsertExchangeRate);
  const rates = ['52.10', '52.25', '52.40', '52.55', '52.70'];
  for (const [index, usdRate] of rates.entries()) {
    await upsertRate.execute(owner, {
      date: day(index - rates.length + 1),
      currency: 'VES',
      usdRate,
      source: 'BCV',
    });
  }

  // ── Accounts and a capital contribution ──────────────────────────────────
  const createAccount = app.get(CreateAccount);
  const vesAccount = (
    await createAccount.execute(owner, {
      name: 'Banco Nacional VES',
      type: 'BANCO_NACIONAL',
      institution: 'Banco Nacional Demo',
      currency: 'VES',
      identifierMasked: '****-****-****-4821',
      holderName: 'WeDevs Demo C.A.',
      openingBalance: '50000.00',
      openingDate: day(-60),
    })
  ).id;
  const usdAccount = (
    await createAccount.execute(owner, {
      name: 'Banco Internacional USD',
      type: 'BANCO_INTERNACIONAL',
      institution: 'International Demo Bank',
      currency: 'USD',
      identifierMasked: '****-9370',
      holderName: 'WeDevs Demo LLC',
      openingBalance: '5000.00',
      openingDate: day(-60),
    })
  ).id;
  const cashAccount = (
    await createAccount.execute(owner, {
      name: 'Caja efectivo USD',
      type: 'EFECTIVO',
      currency: 'USD',
      openingBalance: '300.00',
      openingDate: day(-60),
    })
  ).id;
  await app.get(CreateMovement).execute(owner, {
    accountId: usdAccount,
    type: 'APORTE_CAPITAL',
    date: day(-58),
    amount: '2000.00',
    usdRate: '1',
    partnerId: owner.userId,
    description: 'Aporte de capital inicial (demo)',
  });

  // ── Billing ──────────────────────────────────────────────────────────────
  const upsertPlan = app.get(UpsertBillingPlan);
  await upsertPlan.execute(owner, {
    projectId: pedidos,
    model: 'PRECIO_FIJO',
    currency: 'USD',
    contractAmount: '6000.00',
    notes: 'Contrato de precio fijo: 50 % anticipo, 50 % a la entrega.',
  });
  const createInstallment = app.get(CreateInstallment);
  await createInstallment.execute(owner, {
    projectId: pedidos,
    kind: 'ANTICIPO',
    label: 'Anticipo 50 %',
    amount: '3000.00',
    currency: 'USD',
    percentage: '50.00',
    dueDate: day(-35),
  });
  await createInstallment.execute(owner, {
    projectId: pedidos,
    kind: 'FINAL',
    label: 'Pago final 50 %',
    amount: '3000.00',
    currency: 'USD',
    percentage: '50.00',
    dueDate: day(30),
  });
  await upsertPlan.execute(owner, { projectId: reservas, model: 'RECURRENTE', currency: 'USD' });
  await app.get(CreateRecurringCharge).execute(owner, {
    projectId: reservas,
    label: 'Mantenimiento mensual',
    amount: '150.00',
    currency: 'USD',
    frequency: 'MENSUAL',
    startDate: day(-60),
    billingDay: 5,
  });
  const installment = async (kind: 'ANTICIPO' | 'FINAL') =>
    (await db.billingInstallment.findFirstOrThrow({ where: { projectId: pedidos, kind } })).id;

  // ── Invoices ─────────────────────────────────────────────────────────────
  const createInvoice = app.get(CreateInvoice);
  const issueDraft = app.get(IssueDraft);
  // Paid: created as a draft, then issued.
  const paidDraft = await createInvoice.execute(owner, {
    clientId: caribe,
    invoiceNumber: 'F-2026-0001',
    controlNumber: '00-000001',
    issueDate: day(-40),
    dueDate: day(-25),
    currency: 'USD',
    usdRate: '1',
    isDraft: true,
    lines: [
      {
        description: 'Anticipo 50 % - Plataforma de pedidos',
        projectId: pedidos,
        installmentId: await installment('ANTICIPO'),
        unitPrice: '3000.00',
        ivaRate: '16.00',
      },
    ],
  });
  const paidInvoice = await issueDraft.execute(owner, { id: paidDraft.id });
  // Draft: stays BORRADOR.
  await createInvoice.execute(owner, {
    clientId: caribe,
    invoiceNumber: 'F-2026-0002',
    issueDate: day(0),
    dueDate: day(30),
    currency: 'USD',
    usdRate: '1',
    isDraft: true,
    lines: [
      {
        description: 'Pago final 50 % - Plataforma de pedidos',
        projectId: pedidos,
        installmentId: await installment('FINAL'),
        unitPrice: '3000.00',
        ivaRate: '16.00',
      },
    ],
  });
  // Overdue and unpaid, in VES.
  await createInvoice.execute(owner, {
    clientId: maria,
    invoiceNumber: 'F-2026-0003',
    issueDate: day(-45),
    dueDate: day(-15),
    currency: 'VES',
    usdRate: '52.10',
    bcvRate: '52.10',
    lines: [
      {
        description: 'Mantenimiento mensual - Landing de reservas',
        projectId: reservas,
        unitPrice: '7815.00',
        ivaRate: '16.00',
      },
    ],
  });
  // Partially paid.
  const partialInvoice = await createInvoice.execute(owner, {
    clientId: brightwave,
    invoiceNumber: 'F-2026-0004',
    issueDate: day(-20),
    dueDate: day(10),
    currency: 'USD',
    usdRate: '1',
    lines: [
      {
        description: 'Taller de descubrimiento',
        projectId: rediseno,
        unitPrice: '1200.00',
        ivaRate: null,
      },
    ],
  });

  // ── Payments ─────────────────────────────────────────────────────────────
  const createPayment = app.get(CreatePayment);
  await createPayment.execute(owner, {
    clientId: caribe,
    date: day(-30),
    accountId: usdAccount,
    methodId: await method('ZELLE'),
    currency: 'USD',
    amount: '3480.00',
    usdRate: '1',
    reference: 'ZEL-DEMO-0001',
    status: 'CONFIRMADO',
    allocations: [
      {
        invoiceId: paidInvoice.id,
        amountPaymentCurrency: '3480.00',
        amountInvoiceCurrency: '3480.00',
      },
    ],
  });
  const partialPayment = await createPayment.execute(owner, {
    clientId: brightwave,
    date: day(-10),
    accountId: usdAccount,
    methodId: await method('TRANSFERENCIA_INTERNACIONAL'),
    currency: 'USD',
    amount: '500.00',
    usdRate: '1',
    reference: 'WIRE-DEMO-0002',
    status: 'CONFIRMADO',
  });
  await app.get(AllocatePayment).execute(owner, {
    paymentId: partialPayment.id,
    invoiceId: partialInvoice.id,
    amountPaymentCurrency: '500.00',
    amountInvoiceCurrency: '500.00',
  });
  await createPayment.execute(owner, {
    clientId: maria,
    date: day(-1),
    accountId: vesAccount,
    methodId: await method('PAGO_MOVIL'),
    currency: 'VES',
    amount: '9065.40',
    usdRate: '52.55',
    reference: 'PM-DEMO-0003',
    status: 'PENDIENTE_VERIFICACION',
  });

  // ── Expenses ─────────────────────────────────────────────────────────────
  const createExpense = app.get(CreateExpense);
  await createExpense.execute(owner, {
    date: day(-12),
    description: 'Hosting VPS - Plataforma de pedidos',
    vendor: 'Hetzner (demo)',
    categoryId: 'ecat_hosting',
    accountId: usdAccount,
    projectId: pedidos,
    currency: 'USD',
    amount: '24.50',
    usdRate: '1',
    status: 'PAGADO',
  });
  await createExpense.execute(owner, {
    date: day(-9),
    description: 'Licencia de herramienta de diseño',
    vendor: 'Figma (demo)',
    categoryId: 'ecat_diseno',
    accountId: vesAccount,
    currency: 'VES',
    amount: '2627.50',
    usdRate: '52.55',
    status: 'PAGADO',
  });
  await createExpense.execute(owner, {
    date: day(-20),
    description: 'Dominio anual',
    vendor: 'Registrador demo',
    categoryId: 'ecat_dominios',
    accountId: cashAccount,
    currency: 'USD',
    amount: '14.00',
    usdRate: '1',
    status: 'PAGADO',
  });
  await createExpense.execute(owner, {
    date: day(0),
    dueDate: day(5),
    description: 'Suscripción API de modelos',
    vendor: 'Proveedor IA (demo)',
    categoryId: 'ecat_apis_modelos',
    currency: 'USD',
    amount: '40.00',
    usdRate: '1',
    status: 'PENDIENTE',
  });
  await app.get(CreateRecurringExpense).execute(owner, {
    name: 'Hosting VPS mensual',
    vendor: 'Hetzner (demo)',
    categoryId: 'ecat_hosting',
    accountId: usdAccount,
    projectId: pedidos,
    currency: 'USD',
    amount: '24.50',
    frequency: 'MENSUAL',
    dayOfPeriod: 1,
    leadDays: 5,
    startDate: day(-60),
  });

  // ── Notes ────────────────────────────────────────────────────────────────
  const createNote = app.get(CreateNote);
  await createNote.execute(owner, {
    title: 'Reunión de arranque con Caribe',
    content: doc(
      'Se acordó el alcance del portal y las fechas de entrega.',
      'Pendiente: confirmar accesos al ERP.',
    ),
    links: [{ entityType: 'CLIENT', entityId: caribe }],
    tagIds: [tagId('vip')],
    pinned: true,
    attachmentFileIds: [],
  });
  await createNote.execute(owner, {
    title: 'Decisiones técnicas del portal',
    content: doc('Next.js en el frontend y NestJS en el backend.'),
    links: [{ entityType: 'PROJECT', entityId: pedidos }],
    tagIds: [tagId('prio')],
    pinned: false,
    attachmentFileIds: [],
  });

  // ── Documents (no file upload: markdown and link formats only) ───────────
  const createDocument = app.get(CreateDocument);
  const prd = await createDocument.execute(owner, {
    title: 'PRD - Plataforma de pedidos',
    typeId: typeId('prd'),
    summary: 'Requisitos del portal de pedidos.',
    alertDaysBefore: 30,
    tagIds: [],
    links: [{ entityType: 'PROJECT', entityId: pedidos }],
  });
  await app.get(SaveDraft).execute(owner, {
    documentId: prd.id,
    content: '# PRD\n\n## Objetivo\nPortal de pedidos para distribuidores.\n',
  });
  await app.get(PublishVersion).execute(owner, {
    documentId: prd.id,
    changelog: 'Primera versión (demo)',
  });
  await createDocument.execute(owner, {
    title: 'Cotización - Rediseño web',
    typeId: typeId('cotizacion'),
    summary: 'Cotización vigente enlazada (sin archivo).',
    expiresAt: day(20),
    alertDaysBefore: 30,
    tagIds: [],
    links: [{ entityType: 'CLIENT', entityId: brightwave }],
    initialVersion: { format: 'ENLACE', url: 'https://docs.example.test/cotizacion-brightwave' },
  });

  // ── Share link ───────────────────────────────────────────────────────────
  await app.get(CreateShareLink).execute(owner, {
    title: 'Documentación para Inversiones Caribe',
    message: 'Material del proyecto (demo).',
    clientId: caribe,
    documents: [{ documentId: prd.id }],
    allowDownload: false,
    expiresAt: day(30),
  });

  // The daily job turns the issued invoice with a past due date into VENCIDA.
  await app.get(MarkOverdueInvoices).execute(SYSTEM_ACTOR);
}

async function summary(prisma: PrismaClient): Promise<Record<string, number>> {
  return {
    users: await prisma.user.count(),
    tags: await prisma.tag.count(),
    clients: await prisma.client.count(),
    contacts: await prisma.contact.count(),
    projects: await prisma.project.count(),
    billingPlans: await prisma.billingPlan.count(),
    installments: await prisma.billingInstallment.count(),
    recurringCharges: await prisma.recurringCharge.count(),
    exchangeRates: await prisma.exchangeRate.count(),
    accounts: await prisma.account.count(),
    accountMovements: await prisma.accountMovement.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
    allocations: await prisma.paymentAllocation.count(),
    expenses: await prisma.expense.count(),
    recurringExpenses: await prisma.recurringExpense.count(),
    notes: await prisma.note.count(),
    documents: await prisma.document.count(),
    shareLinks: await prisma.shareLink.count(),
  };
}

@Module({ imports: [AppModule] })
class SeedDemoModule {}

async function main(): Promise<void> {
  const url = assertDemoSeedTarget(process.env.DATABASE_URL, process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  try {
    await wipeBusinessData(prisma);
    await seedCatalogs(prisma);
    const app = await NestFactory.createApplicationContext(SeedDemoModule, { logger: false });
    try {
      await seedDemo(app);
    } finally {
      await app.close();
    }
    console.log('Demo data ready:');
    for (const [name, count] of Object.entries(await summary(prisma))) {
      console.log(`  ${name}: ${count}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error: unknown) => {
    if (error instanceof SeedTargetError) {
      console.error(error.message);
      process.exit(1);
    }
    // Print only the error name/code, never the message (it may carry connection details).
    const code = (error as { code?: unknown } | null)?.code;
    const name = error instanceof Error ? error.name : 'UnknownError';
    console.error(`Demo seed failed: ${typeof code === 'string' ? code : name}`);
    process.exit(1);
  });
}
