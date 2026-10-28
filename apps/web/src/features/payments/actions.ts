"use server";

import { idSchema } from "@/lib/validators/common";
import {
  createPaymentInputSchema,
  detectDuplicatePaymentInputSchema,
  paymentFiltersSchema,
} from "@/lib/validators/payments";
import * as payments from "@/mocks/services/payments";
import { z } from "@/lib/validators/zod";
import type { EntityRef } from "@/lib/validators/common";
import { defineAction } from "@/server/actions/define-action";

// Server Actions of the payments module (PRD §8.6, HU-13). Each one: session → `can()` → Zod parse → service →
// revalidate → `ActionResult`. The UI hiding a button is cosmetic; these checks are the rule.

export const createPaymentAction = defineAction({
  permission: { action: "create", resource: "payment" },
  input: createPaymentInputSchema,
  revalidate: ["/payments", "/payments/list", "/invoices", "/accounts"],
  handler: (ctx, data) => payments.createPayment(ctx, data),
});

/** Possible duplicate of a reference (HU-13 CA6): a read, shown as a warning before saving. */
export const detectDuplicatePaymentAction = defineAction({
  permission: { action: "read", resource: "payment" },
  input: detectDuplicatePaymentInputSchema,
  handler: (ctx, data) => payments.detectDuplicatePayment(ctx, data),
});

/** Open invoices of a client for the "Aplicar a facturas" section (HU-13 CA1). */
export const listOpenInvoicesAction = defineAction({
  permission: { action: "read", resource: "invoice" },
  input: z.object({ clientId: idSchema }),
  handler: (ctx, data) => payments.listOpenInvoicesForClient(ctx, data.clientId),
});

/** The `/payments/list` table reloads its rows through this read when the URL query changes (same grant as the page). */
export const listPaymentsAction = defineAction({
  permission: { action: "read", resource: "payment" },
  input: paymentFiltersSchema,
  handler: (ctx, data) => payments.listPayments(ctx, data),
});

const searchPaymentsInputSchema = z.object({ q: z.string().trim().max(200).default("") });

/** Async payment combobox of the note link picker: at most 20 `EntityRef` options matching `q`. */
export const searchPaymentsAction = defineAction({
  permission: { action: "read", resource: "payment" },
  input: searchPaymentsInputSchema,
  handler: async (ctx, data): Promise<EntityRef[]> => {
    const page = await payments.listPayments(
      ctx,
      paymentFiltersSchema.parse({ q: data.q, pageSize: 25 }),
    );
    return page.items.slice(0, 20).map((row) => ({
      id: row.id,
      code: row.code,
      label: row.code,
      type: "PAYMENT" as const,
    }));
  },
});
