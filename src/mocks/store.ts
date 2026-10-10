// MOCK — the in-memory store of Hito 1 (DT-32, data-rules.md §2). One object on `globalThis` (it survives
// hot reload), built lazily from the typed fixtures on first access, one typed collection per model the UI
// needs. Mock services read and write it through `ctx.db`; it replaces Prisma until Hito 2 and is deleted
// with `src/mocks/` at the close of Hito 2 (C9).
import { todayInCaracas } from "@/lib/dates";
import type {
  ExchangeRateDTO,
  CurrencyDTO,
  ExpenseCategoryDTO,
  PaymentMethodDTO,
} from "@/lib/validators/catalogs";
import type { FileDTO } from "@/lib/validators/files";
import type { PreferenceKey, SetPreferenceInput } from "@/lib/validators/preferences";
import type { CompanySettings, FiscalSettings } from "@/lib/validators/settings";
import type { UserDetailDTO } from "@/lib/validators/users";
import type { ClientDetailDTO } from "@/lib/validators/clients";
import type { ContactDetailDTO } from "@/lib/validators/contacts";
import type { ProjectDetailDTO } from "@/lib/validators/projects";
import type { BillingPlanDTO, InstallmentDTO, RecurringChargeDTO } from "@/lib/validators/billing";
import type { InvoiceDetailDTO } from "@/lib/validators/invoices";
import type { PaymentAllocationDTO, PaymentDetailDTO } from "@/lib/validators/payments";
import type { AccountDTO, MovementDTO, TransferDTO } from "@/lib/validators/accounts";
import type { ExpenseDetailDTO, RecurringExpenseDTO } from "@/lib/validators/expenses";
import type {
  DocumentDetailDTO,
  DocumentLinkDTO,
  DocumentVersionDetailDTO,
} from "@/lib/validators/documents";
import type { ShareAccessLogRowDTO, ShareLinkDetailDTO } from "@/lib/validators/shares";
import type { NoteDetailDTO } from "@/lib/validators/notes";
import type { ActivityEntryDTO } from "@/lib/validators/activity";
import {
  createMockSequences,
  syncMockSequences,
  type MockIdCounters,
  type MockSequences,
} from "./ids";
import {
  createCatalogFixtures,
  type DocumentCategoryRow,
  type DocumentTypeRow,
  type TagRow,
  type TechnologyRow,
} from "./fixtures/catalogs";
import { clientFixtures } from "./fixtures/clients";
import { contactFixtures } from "./fixtures/contacts";
import { projectFixtures } from "./fixtures/projects";
import {
  billingPlanFixtures,
  installmentFixtures,
  recurringChargeFixtures,
} from "./fixtures/billing";
import {
  invoiceFixtures,
  invoiceTaxLineFixtures,
  type InvoiceTaxLineRow,
} from "./fixtures/invoices";
import { paymentAllocationFixtures, paymentFixtures } from "./fixtures/payments";
import { accountFixtures, movementFixtures, transferFixtures } from "./fixtures/accounts";
import { expenseFixtures, recurringExpenseFixtures } from "./fixtures/expenses";
import {
  documentFixtures,
  documentLinkFixtures,
  documentVersionFixtures,
  fileFixtures,
} from "./fixtures/documents";
import {
  shareAccessLogFixtures,
  shareDocumentKeyFixtures,
  shareLinkFixtures,
  type ShareDocumentKeyRow,
} from "./fixtures/shares";
import { noteFixtures } from "./fixtures/notes";
import {
  activityFixtures,
  alertDismissalFixtures,
  type AlertDismissalRow,
} from "./fixtures/activity";

export type { InvoiceTaxLineRow, ShareDocumentKeyRow, AlertDismissalRow };

/** `UserPreference` row: `{ userId, key, value }` (PRD §8.15); one per user and key. */
export interface PreferenceRow {
  userId: string;
  key: PreferenceKey;
  value: SetPreferenceInput["value"];
}

/**
 * One typed collection per model the UI needs. Catalog collections are filled by `fixtures/catalogs.ts`;
 * the module collections start empty and are owned by the module packages (typed with the DTOs of
 * `src/lib/validators`, which module packages may refine into stored rows).
 */
export interface MockStore {
  /** Last value handed out per entity-code prefix (`CLI`, `PRY`, `FAC`, `PAG`, `GAS`, `DOC`). */
  sequences: MockSequences;
  /** Counters behind `nextMockId` for runtime-created records. */
  idCounters: MockIdCounters;

  // Identity and settings
  users: UserDetailDTO[];
  preferences: PreferenceRow[];
  company: CompanySettings;
  fiscal: FiscalSettings;
  files: FileDTO[];

  // Catalogs
  currencies: CurrencyDTO[];
  exchangeRates: ExchangeRateDTO[];
  paymentMethods: PaymentMethodDTO[];
  documentCategories: DocumentCategoryRow[];
  documentTypes: DocumentTypeRow[];
  expenseCategories: ExpenseCategoryDTO[];
  technologies: TechnologyRow[];
  tags: TagRow[];

  // Commercial core
  clients: ClientDetailDTO[];
  contacts: ContactDetailDTO[];
  projects: ProjectDetailDTO[];

  // Finance
  billingPlans: BillingPlanDTO[];
  installments: InstallmentDTO[];
  recurringCharges: RecurringChargeDTO[];
  invoices: InvoiceDetailDTO[];
  /** Δ1: one row per distinct VAT rate of each invoice (derived with the invoice totals). */
  invoiceTaxLines: InvoiceTaxLineRow[];
  payments: PaymentDetailDTO[];
  paymentAllocations: PaymentAllocationDTO[];
  accounts: AccountDTO[];
  transfers: TransferDTO[];
  movements: MovementDTO[];
  expenses: ExpenseDetailDTO[];
  recurringExpenses: RecurringExpenseDTO[];

  // Documents and portal
  documents: DocumentDetailDTO[];
  documentVersions: DocumentVersionDetailDTO[];
  documentLinks: DocumentLinkDTO[];
  shareLinks: ShareLinkDetailDTO[];
  /** Δ2: access-key hashes per shared document. Never copied into a read DTO (C22). */
  shareDocumentKeys: ShareDocumentKeyRow[];
  shareAccessLogs: ShareAccessLogRowDTO[];

  // Knowledge and cross-cutting
  notes: NoteDetailDTO[];
  activity: ActivityEntryDTO[];
  alertDismissals: AlertDismissalRow[];
}

// ───────────────────────────── Derive hooks ─────────────────────────────

/**
 * A pure pass over the store that recomputes derived values (invoice totals, tax lines, `paidAmount`,
 * `balance`, `status`, account balances, installment status…) through `src/lib/finance/*` (data-rules.md
 * §2: "Derived values are computed, not typed in"). Module packages register theirs; hooks run in
 * registration order when the store is built and after every mock mutation (`deriveMockStore`).
 */
export type DeriveHook = (store: MockStore) => void;

interface MockGlobalState {
  store?: MockStore;
  /** Keyed by name so a hot-reloaded module that registers again replaces its hook instead of doubling it. */
  deriveHooks: Map<string, DeriveHook>;
}

const GLOBAL_KEY = "__wedevsMockState";

function globalState(): MockGlobalState {
  const holder = globalThis as typeof globalThis & { [GLOBAL_KEY]?: MockGlobalState };
  return (holder[GLOBAL_KEY] ??= { deriveHooks: new Map() });
}

/** Registers (or replaces) the derive hook `name`. Call at module load from the module's mock service. */
export function registerDeriveHook(name: string, hook: DeriveHook): void {
  globalState().deriveHooks.set(name, hook);
}

/** Names of the registered derive hooks, in run order. */
export function listDeriveHooks(): string[] {
  return [...globalState().deriveHooks.keys()];
}

/** Runs every derive hook over the store. Mock services call it after each mutation. */
export function deriveMockStore(store: MockStore = getMockStore()): void {
  for (const hook of globalState().deriveHooks.values()) hook(store);
}

/** Built-in hook: keeps each code sequence at or above the highest code present, so new codes never collide. */
function deriveSequences(store: MockStore): void {
  syncMockSequences(store.sequences, {
    CLI: store.clients.map((row) => row.code),
    PRY: store.projects.map((row) => row.code),
    FAC: store.invoices.map((row) => row.code),
    PAG: store.payments.map((row) => row.code),
    GAS: store.expenses.map((row) => row.code),
    DOC: store.documents.map((row) => row.code),
  });
}

// ───────────────────────────── Build, access, reset ─────────────────────────────

/**
 * Builds a fresh store from the fixtures (deep copies, so mutations never reach the fixtures) and runs the
 * derive hooks. `now` anchors the exchange-rate history; business "today" is the Caracas day (C11 allows
 * the clock here: this is store infrastructure, not a service).
 */
export function buildMockStore(now: Date = new Date()): MockStore {
  const catalogs = createCatalogFixtures(todayInCaracas(now));
  const store: MockStore = structuredClone({
    sequences: createMockSequences(),
    idCounters: {},

    users: catalogs.users,
    preferences: [],
    company: catalogs.company,
    fiscal: catalogs.fiscal,
    files: fileFixtures,

    currencies: catalogs.currencies,
    exchangeRates: catalogs.exchangeRates,
    paymentMethods: catalogs.paymentMethods,
    documentCategories: catalogs.documentCategories,
    documentTypes: catalogs.documentTypes,
    expenseCategories: catalogs.expenseCategories,
    technologies: catalogs.technologies,
    tags: catalogs.tags,

    clients: clientFixtures,
    contacts: contactFixtures,
    projects: projectFixtures,

    billingPlans: billingPlanFixtures,
    installments: installmentFixtures,
    recurringCharges: recurringChargeFixtures,
    invoices: invoiceFixtures,
    invoiceTaxLines: invoiceTaxLineFixtures,
    payments: paymentFixtures,
    paymentAllocations: paymentAllocationFixtures,
    accounts: accountFixtures,
    transfers: transferFixtures,
    movements: movementFixtures,
    expenses: expenseFixtures,
    recurringExpenses: recurringExpenseFixtures,

    documents: documentFixtures,
    documentVersions: documentVersionFixtures,
    documentLinks: documentLinkFixtures,
    shareLinks: shareLinkFixtures,
    shareDocumentKeys: shareDocumentKeyFixtures,
    shareAccessLogs: shareAccessLogFixtures,

    notes: noteFixtures,
    activity: activityFixtures,
    alertDismissals: alertDismissalFixtures,
  } satisfies MockStore);

  deriveSequences(store);
  deriveMockStore(store);
  return store;
}

/** The store of this server process, built on first access. */
export function getMockStore(): MockStore {
  const state = globalState();
  return (state.store ??= buildMockStore());
}

/**
 * Rebuilds the store from the fixtures ("Reset mock data", MOCK-only). The existing object is refilled in
 * place, so a context created before the reset sees the fresh data too.
 */
export function resetMockStore(now: Date = new Date()): MockStore {
  const state = globalState();
  const fresh = buildMockStore(now);
  if (!state.store) {
    state.store = fresh;
    return fresh;
  }
  Object.assign(state.store, fresh);
  return state.store;
}
