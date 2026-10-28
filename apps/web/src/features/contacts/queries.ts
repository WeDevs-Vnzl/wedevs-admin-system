import "server-only";
import { contactFilterSchema, type ContactFilterInput } from "@/lib/validators/contacts";
import * as contacts from "@/mocks/services/contacts";
import { getServiceContext } from "@/server/context";

/** Contacts of one client (`clientId` is required by the filter). Archived ones need the trash grant. */
export async function listContacts(input: ContactFilterInput) {
  return contacts.listContacts(await getServiceContext(), contactFilterSchema.parse(input));
}
