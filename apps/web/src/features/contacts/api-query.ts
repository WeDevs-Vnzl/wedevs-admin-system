import type { ContactListQuery, ContactListSort } from "@/lib/api/types/clients";
import type { ContactFilter } from "@/lib/validators/contacts";

/** Sort tokens of `GET /api/v1/clients/{id}/contacts`; exhaustive over the generated union (C8). */
const CONTACT_SORTS: Record<ContactListSort, true> = {
  "fullName:asc": true,
  "fullName:desc": true,
  "position:asc": true,
  "position:desc": true,
  "email:asc": true,
  "email:desc": true,
  "isPrimary:asc": true,
  "isPrimary:desc": true,
  "createdAt:asc": true,
  "createdAt:desc": true,
};

function isContactListSort(value: string): value is ContactListSort {
  return Object.hasOwn(CONTACT_SORTS, value);
}

/** The contacts filter of one client → the query parameters of the list (`clientId` goes in the path). */
export function toContactListQuery(filter: ContactFilter): ContactListQuery {
  const query: ContactListQuery = {
    page: filter.page,
    pageSize: filter.pageSize,
    archived: filter.includeArchived ? "include" : "exclude",
  };
  if (filter.q !== undefined) query.q = filter.q;
  if (filter.sort !== undefined && isContactListSort(filter.sort)) query.sort = filter.sort;
  return query;
}
