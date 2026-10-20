"use server";

import {
  archiveContactInputSchema,
  createContactInputSchema,
  setPrimaryContactInputSchema,
  updateContactInputSchema,
} from "@/lib/validators/contacts";
import { idSchema, listQuerySchema } from "@/lib/validators/common";
import * as contacts from "@/mocks/services/contacts";
import { defineAction } from "@/server/actions/define-action";

// Contacts live in the client's Contactos tab and in the client "Resumen": refresh the `/clients` subtree.
// There is no CONTACT export: `contactFilterSchema` requires a `clientId` (no global table in the MVP).
const REVALIDATE = [{ path: "/clients", type: "layout" }] as const;

export const createContactAction = defineAction({
  permission: { action: "create", resource: "contact" },
  input: createContactInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => contacts.createContact(ctx, data),
});

export const updateContactAction = defineAction({
  permission: { action: "update", resource: "contact" },
  input: updateContactInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => contacts.updateContact(ctx, data),
});

/** Makes the contact the client's only primary one (HU-04 CA2). */
export const setPrimaryContactAction = defineAction({
  permission: { action: "update", resource: "contact" },
  input: setPrimaryContactInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => contacts.setPrimaryContact(ctx, data),
});

export const archiveContactAction = defineAction({
  permission: { action: "delete", resource: "contact" },
  input: archiveContactInputSchema,
  revalidate: REVALIDATE,
  handler: (ctx, data) => contacts.archiveContact(ctx, data),
});

/** Typeahead for the note link picker: up to 20 live contacts as `EntityRef`s, optionally of one client. */
export const searchContactsAction = defineAction({
  permission: { action: "read", resource: "contact" },
  input: listQuerySchema.pick({ q: true }).extend({ clientId: idSchema.optional() }),
  handler: (ctx, data) =>
    contacts.searchContacts(ctx, { q: data.q, clientId: data.clientId, limit: 20 }),
});
