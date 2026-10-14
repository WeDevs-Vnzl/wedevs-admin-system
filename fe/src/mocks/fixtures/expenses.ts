// MOCK — expenses fixtures of H1-B3 (data-rules.md §2). Seeded by the expenses module: a few operating expenses
// (paid and pending, one voided, one charged to a seeded project) and two recurring subscriptions. Derived
// values (`overdue`, the recurring `nextDueDate`) are recomputed by the service; `amountUsd` is the snapshot
// at the rate of the day (§9.2, never recomputed). The paid expenses are debited from the VES bank account,
// the only account whose balance the accounts tests do not pin on a paid expense's absence (see the H1-B3 report).
import type { EntityRef } from "@/lib/validators/common";
import type {
  ExpenseCategoryRef,
  ExpenseDetailDTO,
  RecurringExpenseDTO,
} from "@/lib/validators/expenses";
import { mockId } from "../ids";
import { EXPENSE_CATEGORY_FIXTURES } from "./catalogs";

const CREATED = "2026-09-01T12:00:00.000Z";
const UPDATED = "2026-10-08T12:00:00.000Z";

const ACCOUNT_VES: EntityRef = {
  id: "acc_caja_ves",
  label: "Caja VES",
  type: "ACCOUNT",
};
const ACCOUNT_ZELLE: EntityRef = { id: "acc_zelle", label: "Zelle USD", type: "ACCOUNT" };
const PROJECT_WEB: EntityRef = {
  id: mockId("pry", "kairos_web"),
  label: "Sitio web Kairos Studio",
  type: "PROJECT",
};

/** The two-level category ref of a catalog fixture (`ecat_<key>`). */
function categoryRef(key: string): ExpenseCategoryRef {
  const row = EXPENSE_CATEGORY_FIXTURES.find((item) => item.id === mockId("ecat", key));
  if (!row) throw new RangeError(`Unknown expense category fixture: ${key}`);
  const parent = row.parentId
    ? EXPENSE_CATEGORY_FIXTURES.find((item) => item.id === row.parentId)
    : undefined;
  return {
    id: row.id,
    name: row.name,
    nameEn: row.nameEn,
    parent: parent ? { id: parent.id, name: parent.name, nameEn: parent.nameEn } : null,
  };
}

/** A full expense row; the overrides carry what differs from a pending USD expense. */
function expense(
  fields: Pick<
    ExpenseDetailDTO,
    | "id"
    | "code"
    | "date"
    | "description"
    | "category"
    | "currency"
    | "amount"
    | "amountUsd"
    | "status"
  > &
    Partial<ExpenseDetailDTO>,
): ExpenseDetailDTO {
  return {
    dueDate: null,
    vendor: null,
    account: null,
    project: null,
    usdRate: "1",
    overdue: false,
    recurring: false,
    paidAt: null,
    accountAmount: null,
    receiptFileId: null,
    receipt: null,
    recurringExpense: null,
    periodStart: null,
    createdAt: CREATED,
    updatedAt: UPDATED,
    createdById: null,
    ...fields,
  };
}

export const expenseFixtures: ExpenseDetailDTO[] = [
  expense({
    id: mockId("exp", "fee_bancaria_septiembre"),
    code: "GAS-0001",
    date: "2026-09-30",
    description: "Comisiones bancarias de septiembre (MOCK)",
    vendor: "Banco MOCK",
    category: categoryRef("comisiones_bancarias"),
    account: ACCOUNT_VES,
    currency: "VES",
    amount: "1800.00",
    // 1800 ÷ 755.16 VES per USD, rounded once (§9.2).
    amountUsd: "2.38",
    usdRate: "755.16",
    status: "PAGADO",
    paidAt: "2026-09-30",
  }),
  expense({
    id: mockId("exp", "landing_kairos"),
    code: "GAS-0002",
    date: "2026-10-02",
    description: "Diseño de landing de Kairos (MOCK)",
    vendor: "Diseñadora MOCK",
    category: categoryRef("freelancers_diseno"),
    project: PROJECT_WEB,
    account: ACCOUNT_VES,
    currency: "VES",
    amount: "450.00",
    amountUsd: "0.60",
    usdRate: "755.16",
    status: "PAGADO",
    paidAt: "2026-10-02",
  }),
  expense({
    id: mockId("exp", "hosting_produccion"),
    code: "GAS-0003",
    date: "2026-10-01",
    dueDate: "2026-10-20",
    description: "Hosting de producción (MOCK)",
    vendor: "Vercel MOCK",
    category: categoryRef("hosting"),
    currency: "USD",
    amount: "49.00",
    amountUsd: "49.00",
    status: "PENDIENTE",
  }),
  expense({
    id: mockId("exp", "proveedor_diseno_vencido"),
    code: "GAS-0004",
    date: "2026-09-20",
    dueDate: "2026-10-05",
    description: "Factura de proveedor de diseño (MOCK)",
    vendor: "Proveedor MOCK",
    category: categoryRef("diseno"),
    currency: "USD",
    amount: "120.00",
    amountUsd: "120.00",
    status: "PENDIENTE",
    overdue: true,
  }),
  expense({
    id: mockId("exp", "renovacion_dominio"),
    code: "GAS-0005",
    date: "2026-10-01",
    dueDate: "2026-10-25",
    description: "Renovación de dominio (MOCK)",
    vendor: "Registrador MOCK",
    category: categoryRef("dominios"),
    currency: "USD",
    amount: "12.00",
    amountUsd: "12.00",
    status: "PENDIENTE",
  }),
  expense({
    id: mockId("exp", "compra_duplicada"),
    code: "GAS-0006",
    date: "2026-09-10",
    description: "Compra duplicada (MOCK)",
    category: categoryRef("diseno"),
    currency: "USD",
    amount: "8.00",
    amountUsd: "8.00",
    status: "ANULADO",
  }),
];

export const recurringExpenseFixtures: RecurringExpenseDTO[] = [
  {
    id: mockId("rex", "suscripcion_ia"),
    name: "Suscripción de IA (MOCK)",
    vendor: "Proveedor de modelos MOCK",
    category: categoryRef("suscripciones_ia"),
    account: ACCOUNT_ZELLE,
    project: null,
    currency: "USD",
    amount: "20.00",
    frequency: "MENSUAL",
    dayOfPeriod: 5,
    leadDays: 5,
    startDate: "2026-11-01",
    endDate: null,
    status: "ACTIVO",
    lastGeneratedPeriodStart: null,
    resumedOn: null,
    nextDueDate: "2026-11-05",
    createdAt: CREATED,
  },
  {
    id: mockId("rex", "hosting_netlify"),
    name: "Hosting Netlify (MOCK)",
    vendor: "Netlify MOCK",
    category: categoryRef("hosting"),
    account: ACCOUNT_ZELLE,
    project: null,
    currency: "USD",
    amount: "19.00",
    frequency: "MENSUAL",
    dayOfPeriod: 10,
    leadDays: 5,
    startDate: "2026-11-01",
    endDate: null,
    status: "PAUSADO",
    lastGeneratedPeriodStart: null,
    resumedOn: null,
    nextDueDate: "2026-11-10",
    createdAt: CREATED,
  },
];
