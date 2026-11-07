"use server";

import { apiAction } from "@/lib/api/action";
import type {
  ArchivedDocumentDto,
  ArchivedDocumentsDto,
  CreateDocumentDto,
  DocumentDetailDto,
  DocumentLinkDto,
  DocumentListResponseDto,
  PublishVersionDto,
  RestoredDocumentDto,
  SaveDraftResponseDto,
  UpdateDocumentDto,
  UploadVersionDto,
} from "@/lib/api/types/documents";
import { entityHref } from "@/lib/entity-routes";
import {
  entityRefSchema,
  errorMessageKey,
  listQuerySchema,
  type ActionResult,
  type EntityRef,
  type Paginated,
} from "@/lib/validators/common";
import {
  documentFilterSchema,
  publishVersionInputSchema,
  restoreVersionInputSchema,
  setDocumentStatusInputSchema,
  uploadVersionInputSchema,
  type ArchiveDocumentInput,
  type ArchiveDocumentsInput,
  type CreateDocumentWithVersionInput,
  type DocumentDetailDTO,
  type DocumentFilterInput,
  type DocumentLinkDTO,
  type DocumentListRowDTO,
  type DocumentLinkTarget,
  type DocumentIdInput,
  type LinkDocumentInput,
  type SaveDraftInput,
  type SaveDraftResultDTO,
  type UnlinkDocumentInput,
  type UpdateDocumentMetaFormValues,
} from "@/lib/validators/documents";
import type { z } from "@/lib/validators/zod";
import { toDocumentListQuery } from "./api-query";
import { toDocumentDetail, toDocumentLinks, toDocumentPage } from "./mappers";

// Thin API proxies (C10): token → one BE call → error mapping → revalidate. The BE decides every grant (`document`
// is CRU for Owner, Admin and Member, R for Viewer), the type rules (`FIRMADO` only on types with signature,
// expiry only on types with expiration), the transition table and the signature lock (`INTEGRITY_LOCK`, DT-138);
// the FE never checks `can()` here and shows the BE's field errors on the form.

/** At most this many options in the attach sheet's document combobox. */
const SEARCH_LIMIT = 20;
/** The BE accepts 25, 50 or 100 per page; the typeahead asks for the smallest and keeps the first 20. */
const SEARCH_PAGE_SIZE = 25;

/** The overview, the table and this document's detail and version pages show what changed. */
function detailPaths(documentId: string) {
  return [
    "/documents",
    "/documents/list",
    { path: `/documents/${documentId}`, type: "layout" as const },
  ];
}

/** The *Documentos* tab of each linked record shows the document: its page is refreshed too. */
function linkedPaths(refs: readonly Pick<EntityRef, "type" | "id">[]): string[] {
  const paths = new Set<string>();
  for (const ref of refs) {
    const href = entityHref(ref);
    if (href) paths.add(href);
  }
  return [...paths];
}

// Form-side input types: optional fields (a change note) may be left out.
type PublishVersionInput = z.input<typeof publishVersionInputSchema>;
type RestoreVersionInput = z.input<typeof restoreVersionInputSchema>;
type SetDocumentStatusInput = z.input<typeof setDocumentStatusInputSchema>;
type UploadVersionInput = z.input<typeof uploadVersionInputSchema>;

const asRefs = (targets: readonly DocumentLinkTarget[] | undefined) =>
  (targets ?? []).map((target) => ({ type: target.entityType, id: target.entityId }));

/** Maps the successful result of an action; a failure passes through untouched. */
async function mapResult<TIn, TOut>(
  result: Promise<ActionResult<TIn>>,
  map: (data: TIn) => TOut,
): Promise<ActionResult<TOut>> {
  const resolved = await result;
  return resolved.ok ? { ok: true, data: map(resolved.data) } : resolved;
}

// ───────────────────────────── Create and update ─────────────────────────────

const createDocument = apiAction<CreateDocumentWithVersionInput, DocumentDetailDto>({
  call: (input, api) => {
    const body: CreateDocumentDto = {
      title: input.title,
      typeId: input.typeId,
      alertDaysBefore: input.alertDaysBefore ?? 30,
      tagIds: input.tagIds ?? [],
      links: input.links ?? [],
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.effectiveDate !== undefined ? { effectiveDate: input.effectiveDate } : {}),
      ...(input.signedAt !== undefined ? { signedAt: input.signedAt } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    };
    const first = input.initialVersion;
    if (first?.format === "ARCHIVO") {
      body.initialVersion = {
        format: "ARCHIVO",
        fileId: first.fileId,
        ...(first.changelog !== undefined ? { changelog: first.changelog } : {}),
      };
    } else if (first?.format === "ENLACE") {
      body.initialVersion = {
        format: "ENLACE",
        url: first.url,
        ...(first.changelog !== undefined ? { changelog: first.changelog } : {}),
      };
    }
    return api.POST("/api/v1/documents", { body });
  },
  revalidate: (input) => ["/documents", ...linkedPaths(asRefs(input.links))],
});

/**
 * Creates a document with its links and, when `initialVersion` is given, its first version in the same atomic call:
 * a file that is not `READY` (`NOT_FOUND`), one already held by a version (`CONFLICT`, DT-136) or a bad URL leaves
 * nothing behind.
 */
export async function createDocumentAction(
  input: CreateDocumentWithVersionInput,
): Promise<ActionResult<DocumentDetailDTO>> {
  return mapResult(createDocument(input), toDocumentDetail);
}

const updateDocumentMeta = apiAction<UpdateDocumentMetaFormValues, DocumentDetailDto>({
  call: ({ id, ...rest }, api) => {
    // The edit form carries every metadata field: a cleared optional field is sent as `null` so it is cleared.
    const body: UpdateDocumentDto = {
      title: rest.title,
      typeId: rest.typeId,
      alertDaysBefore: rest.alertDaysBefore ?? 30,
      tagIds: rest.tagIds ?? [],
      summary: rest.summary ?? null,
      effectiveDate: rest.effectiveDate ?? null,
      signedAt: rest.signedAt ?? null,
      expiresAt: rest.expiresAt ?? null,
    };
    return api.PATCH("/api/v1/documents/{id}", { params: { path: { id } }, body });
  },
  revalidate: (_input, document) => [
    ...detailPaths(document.id),
    ...linkedPaths(document.links.map((link) => link.entity)),
  ],
});

/** Updates the metadata of a document (`/documents/[id]/edit`); the BE enforces the rules of the chosen type. */
export async function updateDocumentMetaAction(
  input: UpdateDocumentMetaFormValues,
): Promise<ActionResult<DocumentDetailDTO>> {
  return mapResult(updateDocumentMeta(input), toDocumentDetail);
}

// ───────────────────────────── Reads behind the screens ─────────────────────────────

const listDocuments = apiAction<DocumentFilterInput, DocumentListResponseDto>({
  call: (input, api) =>
    api.GET("/api/v1/documents", {
      params: { query: toDocumentListQuery(documentFilterSchema.parse(input)) },
    }),
});

/** One page of `/documents/list` for the table's query (facets, search, sort, pagination). The filter is checked for UX. */
export async function listDocumentsAction(
  input: DocumentFilterInput,
): Promise<ActionResult<Paginated<DocumentListRowDTO>>> {
  if (!documentFilterSchema.safeParse(input).success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  return mapResult(listDocuments(input), toDocumentPage);
}

const searchInputSchema = listQuerySchema.pick({ q: true });

const searchDocuments = apiAction<{ q?: string | undefined }, DocumentListResponseDto>({
  call: ({ q }, api) =>
    api.GET("/api/v1/documents", {
      params: { query: { ...(q ? { q } : {}), pageSize: SEARCH_PAGE_SIZE, archived: "exclude" } },
    }),
});

/**
 * Read behind the link picker's `AsyncCombobox` (also the notes link picker and the share form): at most 20 live
 * documents (archived are not requested) as `EntityRef` options for the trimmed `q`, over `GET /api/v1/documents`
 * (the BE has no `/documents/search`). The wire `code: null` is parsed to `undefined` (`entityRefSchema`).
 */
export async function searchDocumentsAction(input: {
  q?: string | undefined;
}): Promise<ActionResult<EntityRef[]>> {
  const parsed = searchInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: { code: "VALIDATION", message: errorMessageKey("VALIDATION") } };
  }
  const result = await searchDocuments(parsed.data);
  if (!result.ok) return result;
  return {
    ok: true,
    data: result.data.items
      .slice(0, SEARCH_LIMIT)
      .map((row) =>
        entityRefSchema.parse({ type: "DOCUMENT", id: row.id, code: row.code, label: row.title }),
      ),
  };
}

// ───────────────────────────── Links ─────────────────────────────

const linkDocument = apiAction<LinkDocumentInput, DocumentLinkDto[]>({
  call: ({ documentId, target }, api) =>
    api.POST("/api/v1/documents/{id}/links", {
      params: { path: { id: documentId } },
      body: { entityType: target.entityType, entityId: target.entityId },
    }),
  revalidate: ({ documentId, target }) => [
    ...detailPaths(documentId),
    ...linkedPaths(asRefs([target])),
  ],
});

/** Links an existing document to a record (the "Vincular existente" mode); an unreadable target is `NOT_FOUND` (DT-142). */
export async function linkDocumentAction(
  input: LinkDocumentInput,
): Promise<ActionResult<DocumentLinkDTO[]>> {
  return mapResult(linkDocument(input), toDocumentLinks);
}

const unlinkDocument = apiAction<UnlinkDocumentInput, DocumentLinkDto[]>({
  call: ({ documentId, target }, api) =>
    api.DELETE("/api/v1/documents/{id}/links/{entityType}/{entityId}", {
      params: {
        path: { id: documentId, entityType: target.entityType, entityId: target.entityId },
      },
    }),
  revalidate: ({ documentId, target }) => [
    ...detailPaths(documentId),
    ...linkedPaths(asRefs([target])),
  ],
});

/** Removes one link; the document and its other links stay (HU-20 CA2). */
export async function unlinkDocumentAction(
  input: UnlinkDocumentInput,
): Promise<ActionResult<DocumentLinkDTO[]>> {
  return mapResult(unlinkDocument(input), toDocumentLinks);
}

// ───────────────────────────── Status and versions ─────────────────────────────

const setDocumentStatus = apiAction<SetDocumentStatusInput, DocumentDetailDto>({
  call: ({ id, status, signedAt }, api) =>
    api.POST("/api/v1/documents/{id}/status", {
      params: { path: { id } },
      body: { status, ...(signedAt !== undefined ? { signedAt } : {}) },
    }),
  revalidate: ({ id }) => detailPaths(id),
});

/** "Cambiar estado": an allowed transition; `FIRMADO` carries its signature date. */
export async function setDocumentStatusAction(
  input: SetDocumentStatusInput,
): Promise<ActionResult<DocumentDetailDTO>> {
  return mapResult(setDocumentStatus(input), toDocumentDetail);
}

const restoreVersion = apiAction<RestoreVersionInput, DocumentDetailDto>({
  call: ({ documentId, versionId, changelog }, api) =>
    api.POST("/api/v1/documents/{id}/versions/{versionId}/restore", {
      params: { path: { id: documentId, versionId } },
      body: changelog !== undefined ? { changelog } : {},
    }),
  revalidate: ({ documentId }) => detailPaths(documentId),
});

/** "Restaurar": a new current version N+1 copying the chosen one; the history is never rewritten. */
export async function restoreDocumentVersionAction(
  input: RestoreVersionInput,
): Promise<ActionResult<DocumentDetailDTO>> {
  return mapResult(restoreVersion(input), toDocumentDetail);
}

const uploadVersion = apiAction<UploadVersionInput, DocumentDetailDto>({
  call: (input, api) => {
    const changelog = input.changelog !== undefined ? { changelog: input.changelog } : {};
    const body: UploadVersionDto =
      input.format === "ARCHIVO"
        ? { format: "ARCHIVO", fileId: input.fileId, ...changelog }
        : { format: "ENLACE", url: input.url, ...changelog };
    return api.POST("/api/v1/documents/{id}/versions", {
      params: { path: { id: input.documentId } },
      body,
    });
  },
  revalidate: ({ documentId }) => detailPaths(documentId),
});

/**
 * "Subir nueva versión" (a `READY` file) or "Actualizar enlace" (an `http(s)` URL). A signed document refuses it
 * (`INTEGRITY_LOCK`, DT-138), a file already held by a version is a `CONFLICT` (DT-136).
 */
export async function uploadNewDocumentVersionAction(
  input: UploadVersionInput,
): Promise<ActionResult<DocumentDetailDTO>> {
  return mapResult(uploadVersion(input), toDocumentDetail);
}

// ───────────────────────────── Markdown editor ─────────────────────────────

/**
 * "Save draft": stores the editor's text as the document's draft and logs the change. It creates no version. The
 * editor never saves on its own; this runs only when the user saves (DT-139).
 */
export const saveDocumentDraftAction = apiAction<SaveDraftInput, SaveDraftResponseDto>({
  call: ({ documentId, content }, api) =>
    api.PUT("/api/v1/documents/{id}/draft", {
      params: { path: { id: documentId } },
      body: { content },
    }),
}) satisfies (input: SaveDraftInput) => Promise<ActionResult<SaveDraftResultDTO>>;

const publishVersion = apiAction<PublishVersionInput, DocumentDetailDto>({
  call: ({ documentId, content, changelog }, api) => {
    const body: PublishVersionDto = {
      ...(content !== undefined ? { content } : {}),
      ...(changelog !== undefined ? { changelog } : {}),
    };
    return api.POST("/api/v1/documents/{id}/versions/publish", {
      params: { path: { id: documentId } },
      body,
    });
  },
  revalidate: ({ documentId }) => detailPaths(documentId),
});

/**
 * "Publicar versión": freezes `content` (the editor's latest text, saved or not) as the immutable version N+1 with
 * the optional change note, and makes it current.
 */
export async function publishDocumentVersionAction(
  input: PublishVersionInput,
): Promise<ActionResult<DocumentDetailDTO>> {
  return mapResult(publishVersion(input), toDocumentDetail);
}

// ───────────────────────────── Archive and restore ─────────────────────────────

/** Soft delete of one document (PRD §7.7); the BE keeps its versions and files. */
export const archiveDocumentAction = apiAction<ArchiveDocumentInput, ArchivedDocumentDto>({
  call: ({ id }, api) => api.POST("/api/v1/documents/{id}/archive", { params: { path: { id } } }),
  revalidate: ({ id }) => detailPaths(id),
});

/** Bulk archive from the table: all or nothing (one unreadable id fails the whole call). */
export const archiveDocumentsAction = apiAction<ArchiveDocumentsInput, ArchivedDocumentsDto>({
  call: ({ ids }, api) => api.POST("/api/v1/documents/archive", { body: { ids } }),
  revalidate: ["/documents", "/documents/list"],
});

/** Restores an archived document (trash roles; the BE decides). Resolves to a reference to the document. */
export const restoreDocumentAction = apiAction<DocumentIdInput, RestoredDocumentDto>({
  call: ({ id }, api) => api.POST("/api/v1/documents/{id}/restore", { params: { path: { id } } }),
  revalidate: ({ id }) => detailPaths(id),
});
