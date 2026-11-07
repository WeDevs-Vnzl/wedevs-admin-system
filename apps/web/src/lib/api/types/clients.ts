import type { components, operations } from "../schema";

// Generated clients and contacts DTOs and query types re-exported for the commercial modules: code outside
// `src/lib/api/**` may not import the schema (ESLint, C8). Nothing here is hand-written.

/** Query of `GET /api/v1/clients`. */
export type ClientListQuery = NonNullable<operations["listClients"]["parameters"]["query"]>;
/** The `sort` tokens `GET /api/v1/clients` accepts. */
export type ClientListSort = NonNullable<ClientListQuery["sort"]>;

/** `GET /api/v1/clients`: one page of clients (money is `null` without the financial grant). */
export type ClientListResponseDto = components["schemas"]["ClientListResponseDto"];
/** One row of the clients table. */
export type ClientListItemDto = ClientListResponseDto["items"][number];
/** One client with its live contacts (create, read, update, status and restore responses). */
export type ClientDetailDto = components["schemas"]["ClientDetailDto"];
/** `GET /api/v1/clients/{id}/summary`: the financial summary, USD decimal strings. */
export type ClientSummaryResponseDto = components["schemas"]["ClientSummaryResponseDto"];
/** `GET /api/v1/clients/overview`: counts and ranked lists (empty lists without the financial grant). */
export type ClientsOverviewDto = components["schemas"]["ClientsOverviewDto"];
export type ClientArchiveResultDto = components["schemas"]["ClientArchiveResultDto"];
export type ClientsArchiveResultDto = components["schemas"]["ClientsArchiveResultDto"];
export type CreateClientDto = components["schemas"]["CreateClientDto"];
export type UpdateClientDto = components["schemas"]["UpdateClientDto"];
export type SetClientStatusDto = components["schemas"]["SetClientStatusDto"];
export type ArchiveClientDto = components["schemas"]["ArchiveClientDto"];
export type ArchiveClientsDto = components["schemas"]["ArchiveClientsDto"];

/** Query of `GET /api/v1/clients/{id}/contacts`. */
export type ContactListQuery = NonNullable<operations["listContacts"]["parameters"]["query"]>;
/** The `sort` tokens the contacts list accepts. */
export type ContactListSort = NonNullable<ContactListQuery["sort"]>;
export type ContactListResponseDto = components["schemas"]["ContactListResponseDto"];
/** One contact (create, update and primary responses; a row of the list). */
export type ContactViewDto = components["schemas"]["ContactViewDto"];
export type ContactArchivedDto = components["schemas"]["ContactArchivedDto"];
export type CreateContactDto = components["schemas"]["CreateContactDto"];
export type UpdateContactDto = components["schemas"]["UpdateContactDto"];

/** One typeahead result (`GET /api/v1/clients/search`, `GET /api/v1/contacts/search`); `code` is `null`-able. */
export type EntityRefDto = components["schemas"]["EntityRefDto"];
