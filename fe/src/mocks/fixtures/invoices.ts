// MOCK — invoices fixtures of Hito 1 (data-rules.md §2, §3a Δ1). The invoices module package (H1-B3 T6) builds the
// invoices screens over them and owns this file from then on. Fixtures store the inputs (lines with their rates
// and discounts, the IVA adjustments, the withholdings); the derived fields, the tax lines and the statuses are
// computed through `lib/finance` by the derive pass of the store (C17). Dates are relative to `SEED_DAY`. No
// payment or allocation is seeded here: the payments module (T7) allocates against these rows.
import { addDays, type DateOnly } from "@/lib/dates";
import { SEED_DAY } from "./seed-day";
import type {
  InvoiceDetailDTO,
  InvoiceLineDTO,
  InvoiceTaxLineDTO,
} from "@/lib/validators/invoices";
import { formatCode, mockId } from "../ids";

/**
 * Δ1 `InvoiceTaxLine` row: one per distinct VAT rate of an invoice, unique on `(invoiceId, ivaRate)`.
 * `ivaAmount` is `round(taxBase × ivaRate / 100, 2) + adjustment`, the adjustment staying within ±0.01.
 */
export interface InvoiceTaxLineRow extends InvoiceTaxLineDTO {
  id: string;
  invoiceId: string;
}

/**
 * A stored invoice: the DTO, archive stamp included. The service hides archived rows from the list and frees their
 * number for a new invoice (HU-11 CA3); the alerts leave them out.
 */
export type InvoiceRow = InvoiceDetailDTO;

// Fixed seed day, like the fixed dates of the payments and expenses fixtures: the derived figures stay the
// same whatever day the store is built (the tests assert them at `FIXED_NOW`).
const today: DateOnly = SEED_DAY;
const stamp = (day: DateOnly) => `${day}T15:00:00.000Z`;

const ZERO = "0.00";

/** Stored line: the inputs; `amount` and `netAmount` are filled by the derive pass. */
function line(
  id: string,
  order: number,
  fields: Pick<InvoiceLineDTO, "description" | "unitPrice" | "ivaRate"> &
    Partial<Pick<InvoiceLineDTO, "quantity" | "discount" | "project" | "installment">>,
): InvoiceLineDTO {
  return {
    id,
    order,
    project: null,
    installment: null,
    quantity: "1",
    discount: ZERO,
    amount: ZERO,
    netAmount: ZERO,
    ...fields,
  };
}

function invoice(fields: {
  key: string;
  code: string;
  client: { id: string; label: string };
  invoiceNumber: string;
  issueDate: DateOnly;
  dueDate: DateOnly;
  lines: InvoiceLineDTO[];
  taxLines?: InvoiceTaxLineDTO[];
}): InvoiceRow {
  return {
    id: mockId("inv", fields.key),
    code: fields.code,
    client: { id: fields.client.id, label: fields.client.label, type: "CLIENT" },
    invoiceNumber: fields.invoiceNumber,
    controlNumber: null,
    issueDate: fields.issueDate,
    dueDate: fields.dueDate,
    currency: "USD",
    usdRate: "1",
    bcvRate: null,
    isDraft: false,
    // Placeholders: the derive pass sets the status and every derived total (C17).
    status: "EMITIDA",
    voidedAt: null,
    voidReason: null,
    fileId: null,
    file: null,
    lines: fields.lines,
    taxLines: fields.taxLines ?? [],
    totals: {
      subtotal: ZERO,
      discount: ZERO,
      exemptAmount: ZERO,
      taxBase: ZERO,
      ivaAmount: ZERO,
      total: ZERO,
      ivaWithheld: ZERO,
      islrWithheld: ZERO,
      otherWithheld: ZERO,
      otherWithheldNote: null,
      receivable: ZERO,
      totalUsd: ZERO,
      receivableUsd: ZERO,
      paidAmount: ZERO,
      balance: ZERO,
      balanceUsd: ZERO,
    },
    allocations: [],
    daysOverdue: 0,
    hasPartialPayment: false,
    createdAt: stamp(fields.issueDate),
    updatedAt: stamp(fields.issueDate),
    createdById: null,
    archivedAt: null,
  };
}

const KAIROS = { id: mockId("cli", "kairos"), label: "Kairos Studio" };
const ZAFIRO = { id: mockId("cli", "zafiro_labs"), label: "Zafiro Labs" };
const KAIROS_WEB: NonNullable<InvoiceLineDTO["project"]> = {
  id: mockId("pry", "kairos_web"),
  code: "PRY-0001",
  label: "Sitio web Kairos Studio",
  type: "PROJECT",
};
/**
 * MOCK seed contract with T7 (payments): `kairos_partial` (receivable 1 392.00, due in the future) takes a 300 USD
 * allocation and `kairos_paid` (receivable exactly 500.00) takes 500 USD. Neither is linked to the installments
 * of `fixtures/billing.ts`, which stay PENDIENTE for the billing tests.
 */
export const invoiceFixtures: InvoiceRow[] = [
  invoice({
    key: "kairos_partial",
    code: formatCode("FAC", 1),
    client: KAIROS,
    invoiceNumber: "KAI-0001",
    issueDate: addDays(today, -10),
    dueDate: addDays(today, 20),
    lines: [
      // Linked to its project so the graph shows the invoice when the project expands (HU-24 CA2).
      line(mockId("inl", "kairos_partial_1"), 0, {
        description: "Desarrollo del sitio corporativo, fase 1 (MOCK)",
        unitPrice: "1200.00",
        ivaRate: "16",
        project: KAIROS_WEB,
      }),
    ],
  }),
  invoice({
    key: "kairos_paid",
    code: formatCode("FAC", 2),
    client: KAIROS,
    invoiceNumber: "KAI-0002",
    issueDate: addDays(today, -5),
    dueDate: addDays(today, 10),
    lines: [
      line(mockId("inl", "kairos_paid_1"), 0, {
        description: "Servicio de exportación (MOCK, exento)",
        unitPrice: "500.00",
        ivaRate: null,
      }),
    ],
  }),
  invoice({
    key: "kairos_overdue",
    code: formatCode("FAC", 3),
    client: KAIROS,
    invoiceNumber: "KAI-0003",
    issueDate: addDays(today, -60),
    dueDate: addDays(today, -30),
    lines: [
      line(mockId("inl", "kairos_overdue_1"), 0, {
        description: "Soporte mensual atrasado (MOCK)",
        unitPrice: "800.00",
        ivaRate: "16",
      }),
    ],
  }),
  // S2 tester case: lines at 16 %, 8 %, 0 % and exempt, a line discount, and a +0.01 adjustment on the 8 % rate.
  invoice({
    key: "zafiro_multi_rate",
    code: formatCode("FAC", 4),
    client: ZAFIRO,
    invoiceNumber: "ZAF-0001",
    issueDate: addDays(today, -4),
    dueDate: addDays(today, 25),
    lines: [
      line(mockId("inl", "zafiro_multi_1"), 0, {
        description: "Licencia de software (MOCK, 16 %)",
        unitPrice: "1000.00",
        discount: "100.00",
        ivaRate: "16",
      }),
      line(mockId("inl", "zafiro_multi_2"), 1, {
        description: "Capacitación (MOCK, 8 %)",
        quantity: "2",
        unitPrice: "250.00",
        ivaRate: "8",
      }),
      line(mockId("inl", "zafiro_multi_3"), 2, {
        description: "Exportación de servicios (MOCK, 0 %)",
        unitPrice: "200.00",
        ivaRate: "0",
      }),
      line(mockId("inl", "zafiro_multi_4"), 3, {
        description: "Servicio exento (MOCK)",
        unitPrice: "300.00",
        ivaRate: null,
      }),
    ],
    taxLines: [{ ivaRate: "8", taxBase: ZERO, ivaAmount: ZERO, adjustment: "0.01" }],
  }),
];

export const invoiceTaxLineFixtures: InvoiceTaxLineRow[] = [];
