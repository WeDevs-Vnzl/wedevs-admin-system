import { idSchema } from "@/lib/validators/common";
import { z } from "@/lib/validators/zod";

/** `markDocumentsSentAction`: the documents the user checked in the `ENVIADO` proposal (A5), none repeated. */
export const markDocumentsSentInputSchema = z.object({
  documentIds: z
    .array(idSchema)
    .min(1)
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length),
});
export type MarkDocumentsSentInput = z.infer<typeof markDocumentsSentInputSchema>;
