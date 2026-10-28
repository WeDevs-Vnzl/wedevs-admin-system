// MOCK — payments fixtures of H1-B3 (data-rules.md §2). Seeded by the payments module (T7): three confirmed Zelle
// payments of Kairos Studio. Two allocate to the invoices of the seed contract (`inv_kairos_partial` leaves PARCIAL,
// `inv_kairos_paid` is settled), the third carries an IGTF of 3 and an unallocated remainder (saldo a favor).
// Derived figures (`netCredited`, `allocatable`, `allocated`, `unallocated`, `allocations`) are recomputed by
// `derive-finance.ts` from the inputs (amounts, IGTF, fee, allocation rows); the values typed here are the ones it
// produces. Allocation labels are placeholders: the service resolves the invoice code when it assembles the DTO.
// USD snapshots are typed at the rate of their day (1 for USD, never recomputed, §9).
import type { PaymentAllocationDTO, PaymentDetailDTO } from "@/lib/validators/payments";
import { mockId } from "../ids";

const CREATED = "2026-09-25T12:00:00.000Z";
const CLIENT = { id: "cli_kairos", label: "Kairos Studio", type: "CLIENT" } as const;
const ACCOUNT = { id: "acc_cobros_usd", label: "Zelle cobros USD", type: "ACCOUNT" } as const;
const METHOD = { id: "pmt_zelle", code: "ZELLE", name: "Zelle", nameEn: "Zelle" } as const;
// Seed contract with T6 (`fixtures/invoices.ts`): referenced by id only.
const INVOICE_PARTIAL = mockId("inv", "kairos_partial");
const INVOICE_PAID = mockId("inv", "kairos_paid");

export const paymentFixtures: PaymentDetailDTO[] = [
  {
    id: "pag_kairos_partial",
    code: "PAG-0001",
    date: "2026-09-25",
    client: CLIENT,
    method: METHOD,
    account: ACCOUNT,
    currency: "USD",
    amount: "300.00",
    amountUsd: "300.00",
    allocated: "300.00",
    unallocated: "0.00",
    reference: "ZL-MOCK-0001",
    status: "CONFIRMADO",
    igtfAmount: "0.00",
    feeAmount: "0.00",
    netCredited: "300.00",
    allocatable: "300.00",
    usdRate: "1",
    receiptFileId: null,
    receipt: null,
    allocations: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    createdById: null,
  },
  {
    id: "pag_kairos_paid",
    code: "PAG-0002",
    date: "2026-09-28",
    client: CLIENT,
    method: METHOD,
    account: ACCOUNT,
    currency: "USD",
    amount: "500.00",
    amountUsd: "500.00",
    allocated: "500.00",
    unallocated: "0.00",
    reference: "ZL-MOCK-0002",
    status: "CONFIRMADO",
    igtfAmount: "0.00",
    feeAmount: "0.00",
    netCredited: "500.00",
    allocatable: "500.00",
    usdRate: "1",
    receiptFileId: null,
    receipt: null,
    allocations: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    createdById: null,
  },
  {
    id: "pag_kairos_credit",
    code: "PAG-0003",
    date: "2026-10-02",
    client: CLIENT,
    method: METHOD,
    account: ACCOUNT,
    currency: "USD",
    amount: "100.00",
    amountUsd: "100.00",
    allocated: "0.00",
    unallocated: "97.00",
    reference: "ZL-MOCK-0003",
    status: "CONFIRMADO",
    // 100 USD with IGTF 3 and no fee: allocatable 97, net credited to the account 100 (HU-13 CA2).
    igtfAmount: "3.00",
    feeAmount: "0.00",
    netCredited: "100.00",
    allocatable: "97.00",
    usdRate: "1",
    receiptFileId: null,
    receipt: null,
    allocations: [],
    createdAt: CREATED,
    updatedAt: CREATED,
    createdById: null,
  },
];

export const paymentAllocationFixtures: PaymentAllocationDTO[] = [
  {
    id: "alo_kairos_partial",
    paymentId: "pag_kairos_partial",
    invoice: { id: INVOICE_PARTIAL, label: INVOICE_PARTIAL, type: "INVOICE" },
    invoiceCurrency: "USD",
    amountPaymentCurrency: "300.00",
    amountInvoiceCurrency: "300.00",
    amountUsd: "300.00",
    createdAt: CREATED,
  },
  {
    id: "alo_kairos_paid",
    paymentId: "pag_kairos_paid",
    invoice: { id: INVOICE_PAID, label: INVOICE_PAID, type: "INVOICE" },
    invoiceCurrency: "USD",
    amountPaymentCurrency: "500.00",
    amountInvoiceCurrency: "500.00",
    amountUsd: "500.00",
    createdAt: CREATED,
  },
];
