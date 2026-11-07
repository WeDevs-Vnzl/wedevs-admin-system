import type { components, operations } from "../schema";

// Generated share-link DTOs and query types re-exported for the shares feature (C8): code outside `src/lib/api/**`
// may not import the schema. The documents re-exports are the reads the share form makes (`GET /documents/{id}` and
// its versions) and the status command behind the `ENVIADO` proposal. Nothing here is hand-written.

/** Query of `GET /api/v1/share-links`. */
export type ShareListQuery = NonNullable<operations["listShareLinks"]["parameters"]["query"]>;
/** The `sort` tokens `GET /api/v1/share-links` accepts. */
export type ShareListSort = NonNullable<ShareListQuery["sort"]>;
/** Query of `GET /api/v1/share-links/{id}/access-log`. */
export type ShareAccessLogQuery = NonNullable<
  operations["listShareAccessLog"]["parameters"]["query"]
>;
/** The `sort` tokens `GET /api/v1/share-links/{id}/access-log` accepts. */
export type ShareAccessLogSort = NonNullable<ShareAccessLogQuery["sort"]>;

/** `GET /api/v1/share-links`: one page of links. */
export type ShareLinkListResponseDto = components["schemas"]["ShareLinkListResponseDto"];
/** One link with its documents and counters (read and revoke responses). */
export type ShareLinkDetailDto = components["schemas"]["ShareLinkDetailDto"];
/** `POST|PATCH /api/v1/share-links`: the link plus the keys this call generated. */
export type ShareLinkMutationResultDto = components["schemas"]["ShareLinkMutationResultDto"];
/** `POST /api/v1/share-links` body: optional fields may be left out. */
export type ShareLinkFormDto = components["schemas"]["ShareLinkFormDto"];
/** `PATCH /api/v1/share-links/{id}` body: every field is sent, nullable ones as `null` (DT-149). */
export type ShareLinkEditDto = components["schemas"]["ShareLinkEditDto"];
/** `GET /api/v1/share-links/{id}/access-log`: one page of events. */
export type ShareAccessLogResponseDto = components["schemas"]["ShareAccessLogResponseDto"];
export type SetShareAccessKeyDto = components["schemas"]["SetShareAccessKeyDto"];
/** `POST .../access-key` response: the clear key is non-null only for `generate` and `regenerate`. */
export type SetShareAccessKeyResultDto = components["schemas"]["SetShareAccessKeyResultDto"];

/** `GET /api/v1/documents/{id}` (the share form reads status, code, title, archive and current version). */
export type ShareDocumentDetailDto = components["schemas"]["DocumentDetailDto"];
/** `GET /api/v1/documents/{id}/versions` item. */
export type ShareDocumentVersionDto = components["schemas"]["DocumentVersionRowDto"];
/** `POST /api/v1/documents/{id}/status` body. */
export type ShareSetDocumentStatusDto = components["schemas"]["SetDocumentStatusDto"];
