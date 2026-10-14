import { idSchema } from "@/lib/validators/common";
import { z } from "@/lib/validators/zod";

/** `attachInvoiceFile`: the PDF of the real invoice, or `null` to detach it (HU-11 CA4). */
export const attachInvoiceFileInputSchema = z.object({
  id: idSchema,
  fileId: idSchema.nullable(),
});
export type AttachInvoiceFileInput = z.infer<typeof attachInvoiceFileInputSchema>;
