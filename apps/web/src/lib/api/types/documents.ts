import type { components, operations } from "../schema";

// Generated document DTOs and query types re-exported for the documents feature (C8): code outside `src/lib/api/**`
// may not import the schema. Nothing here is hand-written.

/** Query of `GET /api/v1/documents`. */
export type DocumentListQuery = NonNullable<operations["listDocuments"]["parameters"]["query"]>;
/** The `sort` tokens `GET /api/v1/documents` accepts. */
export type DocumentListSort = NonNullable<DocumentListQuery["sort"]>;

/** `GET /api/v1/documents`: one page of documents. */
export type DocumentListResponseDto = components["schemas"]["DocumentListResponseDto"];
/** One row of the documents table. */
export type DocumentListItemDto = DocumentListResponseDto["items"][number];
/** One document with its current version, links and draft (the detail and every write response). */
export type DocumentDetailDto = components["schemas"]["DocumentDetailDto"];
/** `GET /api/v1/documents/overview`. */
export type DocumentsOverviewDto = components["schemas"]["DocumentsOverviewDto"];
/** `GET /api/v1/documents/{id}/versions` rows (no markdown content). */
export type DocumentVersionRowDto = components["schemas"]["DocumentVersionRowDto"];
/** `GET /api/v1/documents/{id}/versions/{versionId}`: one version with its markdown content. */
export type DocumentVersionDetailDto = components["schemas"]["DocumentVersionDetailDto"];
/** `POST|DELETE /api/v1/documents/{id}/links`: the document's links after the change. */
export type DocumentLinkDto = components["schemas"]["DocumentLinkDto"];
export type DocumentLinkTargetDto = components["schemas"]["DocumentLinkTargetDto"];
/** `PUT /api/v1/documents/{id}/draft` response. */
export type SaveDraftResponseDto = components["schemas"]["SaveDraftResponseDto"];
export type ArchivedDocumentDto = components["schemas"]["ArchivedDocumentDto"];
export type ArchivedDocumentsDto = components["schemas"]["ArchivedDocumentsDto"];
/** `POST /api/v1/documents/{id}/restore` response: a reference to the restored document. */
export type RestoredDocumentDto = components["schemas"]["EntityRefResponseDto"];
export type CreateDocumentDto = components["schemas"]["CreateDocumentDto"];
export type UpdateDocumentDto = components["schemas"]["UpdateDocumentDto"];
export type SetDocumentStatusDto = components["schemas"]["SetDocumentStatusDto"];
export type PublishVersionDto = components["schemas"]["PublishVersionDto"];
export type UploadVersionDto = components["schemas"]["UploadVersionDto"];
export type RestoreVersionDto = components["schemas"]["RestoreVersionDto"];

/** `GET /api/v1/documents/category-counts`: count per category id (categories without documents are absent). */
export type DocumentCategoryCountsDto = {
  [categoryId: string]: number;
};
