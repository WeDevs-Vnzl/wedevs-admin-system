import { z } from "./zod";
import { VALIDATION_MESSAGES, idSchema, listQuerySchema, type Paginated } from "./common";
import {
  optionalEmailSchema,
  optionalText,
  requiredText,
  tagChipSchema,
  timestampSchema,
  uniqueIds,
  withSortFields,
} from "./tags";
import type { ArchivedRecordDTO } from "./trash";

/**
 * Contacts (PRD §8.2 "Contacto"): people of a client, managed in the client's Contactos tab (no global
 * table in the MVP). A contact needs a name and at least one contact method (email or phone); a client
 * has at most one primary contact.
 */

// ───────────────────────────── Phone ─────────────────────────────

/** E.164: `+` and 7 to 15 digits, the first not `0` (`+584121234567`). */
export const E164_PATTERN = /^\+[1-9]\d{6,14}$/;

export function isE164Phone(value: string): boolean {
  return E164_PATTERN.test(value);
}

/** Required phone in E.164 (the international phone component emits it). */
export const e164PhoneSchema = z
  .string()
  .trim()
  .regex(E164_PATTERN, VALIDATION_MESSAGES.invalidFormat);

/** Optional phone in E.164 (`""` → `undefined`). */
export const optionalPhoneSchema = z
  .string()
  .trim()
  .refine((value) => value === "" || isE164Phone(value), {
    message: VALIDATION_MESSAGES.invalidFormat,
  })
  .optional()
  .transform((value) => (value ? value : undefined));

// ───────────────────────────── Inputs ─────────────────────────────

const contactFieldsShape = {
  fullName: requiredText(120),
  position: optionalText(80),
  email: optionalEmailSchema,
  phone: optionalPhoneSchema,
  isPrimary: z.boolean().default(false),
  tagIds: uniqueIds({ max: 50 }).default([]),
};

/** At least one of email / phone. The issue is reported on both fields so each shows the message. */
function requireContactMethod(
  value: { email?: string | undefined; phone?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.email || value.phone) return;
  for (const path of ["email", "phone"]) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: [path] });
  }
}

/** `createContact`: the contact belongs to `clientId`. A new primary contact demotes the previous one. */
export const createContactInputSchema = z
  .object({ clientId: idSchema, ...contactFieldsShape })
  .superRefine(requireContactMethod);
export type CreateContactInput = z.infer<typeof createContactInputSchema>;

/** `updateContact`: the edit modal submits every editable field. The client never changes. */
export const updateContactInputSchema = z
  .object({ id: idSchema, ...contactFieldsShape })
  .superRefine(requireContactMethod);
export type UpdateContactInput = z.infer<typeof updateContactInputSchema>;

/** `setPrimaryContact`: makes this contact the client's only primary contact. */
export const setPrimaryContactInputSchema = z.object({ id: idSchema });
export type SetPrimaryContactInput = z.infer<typeof setPrimaryContactInputSchema>;

/** `archiveContact` (soft delete). */
export const archiveContactInputSchema = z.object({ id: idSchema });
export type ArchiveContactInput = z.infer<typeof archiveContactInputSchema>;

export const contactIdInputSchema = z.object({ id: idSchema });
export type ContactIdInput = z.infer<typeof contactIdInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const CONTACT_SORT_FIELDS = [
  "fullName",
  "position",
  "email",
  "isPrimary",
  "createdAt",
] as const;

/** Contacts of one client (the tab's mini-table). */
export const contactFilterSchema = withSortFields(
  listQuerySchema.extend({ clientId: idSchema }),
  CONTACT_SORT_FIELDS,
);
export type ContactFilter = z.infer<typeof contactFilterSchema>;
export type ContactFilterInput = z.input<typeof contactFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

export const contactDetailSchema = z.object({
  id: idSchema,
  clientId: idSchema,
  fullName: z.string(),
  position: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  isPrimary: z.boolean(),
  tags: z.array(tagChipSchema),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type ContactDetailDTO = z.infer<typeof contactDetailSchema>;

/** Row of the client's Contactos tab. */
export const contactListRowSchema = contactDetailSchema;
export type ContactListRowDTO = z.infer<typeof contactListRowSchema>;

// ───────────────────────────── Services (PRD §12 `contacts`) ─────────────────────────────

/**
 * `contacts` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11). `listContacts` is the
 * read counterpart that PRD §12 leaves implicit.
 */
export type ContactsService<Ctx = unknown> = {
  createContact: (ctx: Ctx, input: CreateContactInput) => Promise<ContactDetailDTO>;
  updateContact: (ctx: Ctx, input: UpdateContactInput) => Promise<ContactDetailDTO>;
  setPrimaryContact: (ctx: Ctx, input: SetPrimaryContactInput) => Promise<ContactDetailDTO>;
  archiveContact: (ctx: Ctx, input: ArchiveContactInput) => Promise<ArchivedRecordDTO>;
  listContacts: (ctx: Ctx, input: ContactFilter) => Promise<Paginated<ContactListRowDTO>>;
};
