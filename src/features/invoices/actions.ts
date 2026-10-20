"use server";

import { z } from "@/lib/validators/zod";
import type { EntityRef } from "@/lib/validators/common";
import {
  createInvoiceInputSchema,
  invoiceFiltersSchema,
  issueDraftInputSchema,
  listOpenInvoicesInputSchema,
  updateInvoiceInputSchema,
  voidInvoiceInputSchema,
  archiveInvoiceInputSchema,
} from "@/lib/validators/invoices";
import * as invoices from "@/mocks/services/invoices";
import { defineAction } from "@/server/actions/define-action";
import { attachInvoiceFileInputSchema } from "./schemas";

// Server Actions of the invoices module (PRD §8.5, HU-11, HU-12). Each one: session → `can()` → Zod parse →
// service → revalidate → `ActionResult`. The UI hiding a button is cosmetic; these checks are the rule.

const LIST_PATHS = ["/invoices", "/invoices/list"];

export const createInvoiceAction = defineAction({
  permission: { action: "create", resource: "invoice" },
  input: createInvoiceInputSchema,
  revalidate: [...LIST_PATHS, "/projects", "/"],
  handler: (ctx, data) => invoices.createInvoice(ctx, data),
});

export const updateInvoiceAction = defineAction({
  permission: { action: "update", resource: "invoice" },
  input: updateInvoiceInputSchema,
  revalidate: (data) => [...LIST_PATHS, `/invoices/${data.id}`, "/projects", "/"],
  handler: (ctx, data) => invoices.updateInvoice(ctx, data),
});

export const issueDraftAction = defineAction({
  permission: { action: "update", resource: "invoice" },
  input: issueDraftInputSchema,
  revalidate: (data) => [...LIST_PATHS, `/invoices/${data.id}`],
  handler: (ctx, data) => invoices.issueDraft(ctx, data),
});

export const voidInvoiceAction = defineAction({
  permission: { action: "update", resource: "invoice" },
  input: voidInvoiceInputSchema,
  revalidate: (data) => [...LIST_PATHS, `/invoices/${data.id}`, "/projects", "/"],
  handler: (ctx, data) => invoices.voidInvoice(ctx, data),
});

export const archiveInvoiceAction = defineAction({
  permission: { action: "update", resource: "invoice" },
  input: archiveInvoiceInputSchema,
  revalidate: LIST_PATHS,
  handler: (ctx, data) => invoices.archiveInvoice(ctx, data),
});

export const attachInvoiceFileAction = defineAction({
  permission: { action: "update", resource: "invoice" },
  input: attachInvoiceFileInputSchema,
  revalidate: (data) => [`/invoices/${data.id}`],
  handler: (ctx, data) => invoices.attachInvoiceFile(ctx, data),
});

/** Read of the "Facturar cuotas" options when the client changes in the form: no write, so the read grant. */
export const listBillableInstallmentsAction = defineAction({
  permission: { action: "read", resource: "invoice" },
  input: listOpenInvoicesInputSchema,
  handler: (ctx, data) => invoices.listBillableInstallments(ctx, data.clientId),
});

/** The invoices table reloads its rows through this read when the URL query changes (same grant as the table). */
export const listInvoicesAction = defineAction({
  permission: { action: "read", resource: "invoice" },
  input: invoiceFiltersSchema,
  handler: (ctx, data) => invoices.listInvoices(ctx, data),
});

const searchInvoicesInputSchema = z.object({ q: z.string().trim().max(200).default("") });

/** Async invoice combobox of the note link picker: at most 20 `EntityRef` options matching `q`. */
export const searchInvoicesAction = defineAction({
  permission: { action: "read", resource: "invoice" },
  input: searchInvoicesInputSchema,
  handler: async (ctx, data): Promise<EntityRef[]> => {
    const page = await invoices.listInvoices(
      ctx,
      invoiceFiltersSchema.parse({ q: data.q, pageSize: 25 }),
    );
    return page.items.slice(0, 20).map((row) => ({
      id: row.id,
      code: row.code,
      label: row.invoiceNumber,
      type: "INVOICE" as const,
    }));
  },
});
