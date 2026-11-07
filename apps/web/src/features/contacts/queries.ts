import "server-only";
import { getServerApi } from "@/lib/api/server";
import { contactFilterSchema, type ContactFilterInput } from "@/lib/validators/contacts";
import { toContactListQuery } from "./api-query";

/**
 * Contacts of one client (`GET /api/v1/clients/{id}/contacts`; `clientId` is required by the filter). Archived
 * ones need the trash grant, which the BE checks.
 */
export async function listContacts(input: ContactFilterInput) {
  const { clientId, ...filter } = contactFilterSchema.parse(input);
  const api = await getServerApi();
  const { data, response } = await api.GET("/api/v1/clients/{id}/contacts", {
    params: { path: { id: clientId }, query: toContactListQuery({ ...filter, clientId }) },
  });
  if (!data)
    throw new Error(`GET /api/v1/clients/${clientId}/contacts failed with ${response.status}`);
  return data;
}
