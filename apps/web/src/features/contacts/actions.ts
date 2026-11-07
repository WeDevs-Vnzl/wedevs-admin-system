"use server";

import { apiAction } from "@/lib/api/action";
import type { ContactArchivedDto, ContactViewDto, EntityRefDto } from "@/lib/api/types/clients";
import {
  entityRefSchema,
  errorMessageKey,
  idSchema,
  listQuerySchema,
  type ActionResult,
  type EntityRef,
} from "@/lib/validators/common";
import type {
  ArchiveContactInput,
  SetPrimaryContactInput,
  createContactInputSchema,
  updateContactInputSchema,
} from "@/lib/validators/contacts";
import type { z } from "@/lib/validators/zod";

// Thin API proxies (C10): the BE decides every grant. Contacts live in the client's Contactos tab and in the
// client "Resumen": refresh the `/clients` subtree. There is no CONTACT export (no global table in the MVP).
const REVALIDATE = [{ path: "/clients", type: "layout" }] as const;

type CreateContactValues = z.input<typeof createContactInputSchema>;
type UpdateContactValues = z.input<typeof updateContactInputSchema>;

/** The editable fields only: the form also carries `clientId` and `id`, which never go in the body. */
function contactBody(input: Omit<UpdateContactValues, "id">) {
  return {
    fullName: input.fullName,
    position: input.position,
    email: input.email,
    phone: input.phone,
    isPrimary: input.isPrimary ?? false,
    tagIds: input.tagIds ?? [],
  };
}

export const createContactAction = apiAction<CreateContactValues, ContactViewDto>({
  call: (input, api) =>
    api.POST("/api/v1/clients/{id}/contacts", {
      params: { path: { id: input.clientId } },
      body: contactBody(input),
    }),
  revalidate: REVALIDATE,
});

export const updateContactAction = apiAction<UpdateContactValues, ContactViewDto>({
  call: (input, api) =>
    api.PATCH("/api/v1/contacts/{id}", {
      params: { path: { id: input.id } },
      body: contactBody(input),
    }),
  revalidate: REVALIDATE,
});

/** Makes the contact the client's only primary one (HU-04 CA2). */
export const setPrimaryContactAction = apiAction<SetPrimaryContactInput, ContactViewDto>({
  call: ({ id }, api) => api.POST("/api/v1/contacts/{id}/primary", { params: { path: { id } } }),
  revalidate: REVALIDATE,
});

/** Archives one contact. There is no per-contact restore: contacts return with their client or from the trash. */
export const archiveContactAction = apiAction<ArchiveContactInput, ContactArchivedDto>({
  call: ({ id }, api) => api.POST("/api/v1/contacts/{id}/archive", { params: { path: { id } } }),
  revalidate: REVALIDATE,
});

const searchInputSchema = listQuerySchema
  .pick({ q: true })
  .extend({ clientId: idSchema.optional() });

const searchContacts = apiAction<z.output<typeof searchInputSchema>, EntityRefDto[]>({
  call: ({ q, clientId }, api) =>
    api.GET("/api/v1/contacts/search", {
      params: { query: { ...(q ? { q } : {}), ...(clientId ? { clientId } : {}), limit: 20 } },
    }),
});

/** Typeahead for the note link picker: up to 20 live contacts as `EntityRef`s, optionally of one client. */
export async function searchContactsAction(
  input: z.input<typeof searchInputSchema>,
): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await searchContacts(parsed.data);
  return result.ok
    ? { ok: true, data: result.data.map((ref) => entityRefSchema.parse(ref)) }
    : result;
}
