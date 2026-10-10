import { z } from "./zod";
import {
  VALIDATION_MESSAGES,
  dateOnlySchema,
  entityRefSchema,
  idSchema,
  listQuerySchema,
  type Paginated,
} from "./common";
import { documentFormatSchema, documentStatusSchema, type DocumentStatus } from "./enums";
import { fileDtoSchema } from "./files";
import {
  documentCategoryRefSchema,
  documentTypeRefSchema,
  type DocumentTypeCapabilities,
} from "./document-types";
import {
  bulkIdsSchema,
  facetOf,
  httpUrlSchema,
  optionalText,
  requiredText,
  tagChipSchema,
  timestampSchema,
  uniqueIds,
  withSortFields,
} from "./tags";
import type { ArchivedRecordDTO } from "./trash";
import { userRefSchema } from "./users";

/**
 * Documents (PRD §8.9): metadata, three formats (`MARKDOWN`, `ARCHIVO`, `ENLACE`), immutable versions,
 * markdown draft autosave, statuses with transitions and links to records.
 *
 * Type rules (PRD §8.9.1/§8.9.4): `signedAt` and the `FIRMADO` status exist only on types with
 * `requiresSignature`; `expiresAt` and `alertDaysBefore` only on types with `hasExpiration`. The base
 * schemas are type-agnostic; the `…For(caps)` factories add the type rules once the form (or the
 * service) knows the selected type's capabilities. A `FIRMADO` document accepts no new versions
 * (INTEGRITY_LOCK, C19). `VENCIDO` is assigned only by the daily job.
 */

/** Keys (namespace `documents`) of the rules that need their own message; owned by the documents UI. */
export const DOCUMENT_VALIDATION_MESSAGES = {
  signedAtNotAllowed: "documents.validation.signedAtNotAllowed",
  expiresAtNotAllowed: "documents.validation.expiresAtNotAllowed",
  signedStatusNotAllowed: "documents.validation.signedStatusNotAllowed",
} as const;

/** Markdown / draft size cap (characters). */
export const DOCUMENT_CONTENT_MAX = 1_000_000;

export const DEFAULT_ALERT_DAYS_BEFORE = 30;

// ───────────────────────────── Statuses and transitions ─────────────────────────────

/** Statuses a person can set. `VENCIDO` is assigned by the daily maintenance job only. */
export const USER_SETTABLE_DOCUMENT_STATUS_VALUES = [
  "BORRADOR",
  "EN_REVISION",
  "APROBADO",
  "ENVIADO",
  "FIRMADO",
  "ANULADO",
] as const satisfies readonly DocumentStatus[];
export const userSettableDocumentStatusSchema = z.enum(USER_SETTABLE_DOCUMENT_STATUS_VALUES);
export type UserSettableDocumentStatus = z.infer<typeof userSettableDocumentStatusSchema>;

/**
 * Allowed transitions (PRD §8.9.4): `BORRADOR ⇄ EN_REVISION → APROBADO → ENVIADO → FIRMADO → VENCIDO
 * (automatic)`; any status except `VENCIDO` can go to `ANULADO`. `FIRMADO` additionally needs a type with
 * `requiresSignature` (see `canTransitionDocument`).
 */
export const DOCUMENT_STATUS_TRANSITIONS: Record<DocumentStatus, readonly DocumentStatus[]> = {
  BORRADOR: ["EN_REVISION", "ANULADO"],
  EN_REVISION: ["BORRADOR", "APROBADO", "ANULADO"],
  APROBADO: ["ENVIADO", "ANULADO"],
  ENVIADO: ["FIRMADO", "ANULADO"],
  FIRMADO: ["ANULADO"],
  VENCIDO: [],
  ANULADO: [],
};

export function canTransitionDocument(
  from: DocumentStatus,
  to: DocumentStatus,
  caps: Pick<DocumentTypeCapabilities, "requiresSignature">,
): boolean {
  if (to === "FIRMADO" && !caps.requiresSignature) return false;
  return DOCUMENT_STATUS_TRANSITIONS[from].includes(to);
}

// ───────────────────────────── Link targets ─────────────────────────────

/** Records a document can be linked to (PRD §8.9.2). A document can also exist with no links. */
export const DOCUMENT_LINK_ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
] as const;
export const documentLinkEntityTypeSchema = z.enum(DOCUMENT_LINK_ENTITY_TYPE_VALUES);
export type DocumentLinkEntityType = z.infer<typeof documentLinkEntityTypeSchema>;

export const documentLinkTargetSchema = z.object({
  entityType: documentLinkEntityTypeSchema,
  entityId: idSchema,
});
export type DocumentLinkTarget = z.infer<typeof documentLinkTargetSchema>;

// ───────────────────────────── Type rules ─────────────────────────────

interface TypeRuleSubject {
  status?: DocumentStatus | undefined;
  signedAt?: string | undefined;
  expiresAt?: string | undefined;
}

/**
 * Issues a document breaks for its type: a signature date or the `FIRMADO` status on a type without
 * signature, an expiry date on a type without expiration. Pure: shared by the forms (through the
 * `…For(caps)` schemas) and by the service.
 */
export function documentTypeRuleIssues(
  caps: DocumentTypeCapabilities,
  value: TypeRuleSubject,
): { path: "signedAt" | "expiresAt" | "status"; message: string }[] {
  const issues: { path: "signedAt" | "expiresAt" | "status"; message: string }[] = [];
  if (!caps.requiresSignature) {
    if (value.signedAt) {
      issues.push({ path: "signedAt", message: DOCUMENT_VALIDATION_MESSAGES.signedAtNotAllowed });
    }
    if (value.status === "FIRMADO") {
      issues.push({ path: "status", message: DOCUMENT_VALIDATION_MESSAGES.signedStatusNotAllowed });
    }
  }
  if (!caps.hasExpiration && value.expiresAt) {
    issues.push({ path: "expiresAt", message: DOCUMENT_VALIDATION_MESSAGES.expiresAtNotAllowed });
  }
  return issues;
}

function typeRules(caps: DocumentTypeCapabilities) {
  return (value: TypeRuleSubject, ctx: z.RefinementCtx): void => {
    for (const issue of documentTypeRuleIssues(caps, value)) {
      ctx.addIssue({ code: "custom", message: issue.message, path: [issue.path] });
    }
  };
}

// ───────────────────────────── Inputs: metadata ─────────────────────────────

const documentFieldsShape = {
  title: requiredText(200),
  /** The category is derived from the type. */
  typeId: idSchema,
  summary: optionalText(1000),
  effectiveDate: dateOnlySchema.optional(),
  /** Only on types with signature. */
  signedAt: dateOnlySchema.optional(),
  /** Only on types with expiration. */
  expiresAt: dateOnlySchema.optional(),
  alertDaysBefore: z.number().int().min(0).max(365).default(DEFAULT_ALERT_DAYS_BEFORE),
  tagIds: uniqueIds({ max: 50 }).default([]),
};

function checkDocumentDates(
  value: { effectiveDate?: string | undefined; expiresAt?: string | undefined },
  ctx: z.RefinementCtx,
): void {
  if (value.effectiveDate && value.expiresAt && value.expiresAt < value.effectiveDate) {
    ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.invalidDate, path: ["expiresAt"] });
  }
}

function uniqueTargets(max: number) {
  return z
    .array(documentLinkTargetSchema)
    .max(max)
    .refine(
      (targets) =>
        new Set(targets.map((t) => `${t.entityType}:${t.entityId}`)).size === targets.length,
      { message: VALIDATION_MESSAGES.invalidOption },
    );
}

/**
 * `createDocument`: metadata only; the document starts as `BORRADOR` with the code `DOC-0001`
 * allocated by the service. Content comes later (`saveDraft`/`publishVersion`/`uploadVersion`). Use
 * `createDocumentInputSchemaFor(type)` once the type is known to enforce the type rules.
 */
export const createDocumentInputSchema = z
  .object({ ...documentFieldsShape, links: uniqueTargets(30).default([]) })
  .superRefine(checkDocumentDates);
export type CreateDocumentInput = z.infer<typeof createDocumentInputSchema>;
export type CreateDocumentFormValues = z.input<typeof createDocumentInputSchema>;

export function createDocumentInputSchemaFor(caps: DocumentTypeCapabilities) {
  return createDocumentInputSchema.superRefine(typeRules(caps));
}

/** `updateDocumentMeta`: metadata of an existing document (status, links and content have own services). */
export const updateDocumentMetaInputSchema = z
  .object({ id: idSchema, ...documentFieldsShape })
  .superRefine(checkDocumentDates);
export type UpdateDocumentMetaInput = z.infer<typeof updateDocumentMetaInputSchema>;
export type UpdateDocumentMetaFormValues = z.input<typeof updateDocumentMetaInputSchema>;

export function updateDocumentMetaInputSchemaFor(caps: DocumentTypeCapabilities) {
  return updateDocumentMetaInputSchema.superRefine(typeRules(caps));
}

/**
 * `setDocumentStatus`. `FIRMADO` requires the signature date (and only exists on types with signature:
 * `setDocumentStatusInputSchemaFor`). `VENCIDO` cannot be set by a person.
 */
export const setDocumentStatusInputSchema = z
  .object({
    id: idSchema,
    status: userSettableDocumentStatusSchema,
    signedAt: dateOnlySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.status === "FIRMADO" && !value.signedAt) {
      ctx.addIssue({ code: "custom", message: VALIDATION_MESSAGES.required, path: ["signedAt"] });
    }
  });
export type SetDocumentStatusInput = z.infer<typeof setDocumentStatusInputSchema>;

export function setDocumentStatusInputSchemaFor(caps: DocumentTypeCapabilities) {
  return setDocumentStatusInputSchema.superRefine(typeRules(caps));
}

/** `archiveDocument` (soft delete). */
export const archiveDocumentInputSchema = z.object({ id: idSchema });
export type ArchiveDocumentInput = z.infer<typeof archiveDocumentInputSchema>;

export const archiveDocumentsInputSchema = z.object({ ids: bulkIdsSchema });
export type ArchiveDocumentsInput = z.infer<typeof archiveDocumentsInputSchema>;

export const documentIdInputSchema = z.object({ id: idSchema });
export type DocumentIdInput = z.infer<typeof documentIdInputSchema>;

// ───────────────────────────── Inputs: content and versions ─────────────────────────────

const changelogSchema = optionalText(500);

/** `saveDraft`: markdown autosave (every 5 s of inactivity). Does not create a version. */
export const saveDraftInputSchema = z.object({
  documentId: idSchema,
  content: z.string().max(DOCUMENT_CONTENT_MAX),
});
export type SaveDraftInput = z.infer<typeof saveDraftInputSchema>;

/**
 * `publishVersion`: freezes the markdown draft as a new immutable version and makes it current. The
 * editor may send the latest `content` to avoid racing the autosave; otherwise the stored draft is used.
 */
export const publishVersionInputSchema = z.object({
  documentId: idSchema,
  content: z.string().min(1).max(DOCUMENT_CONTENT_MAX).optional(),
  changelog: changelogSchema,
});
export type PublishVersionInput = z.infer<typeof publishVersionInputSchema>;

/** `uploadVersion`: "Subir nueva versión" (a `READY` file) or "Actualizar enlace" (an `http(s)` URL). */
export const uploadVersionInputSchema = z.discriminatedUnion("format", [
  z.object({
    format: z.literal("ARCHIVO"),
    documentId: idSchema,
    fileId: idSchema,
    changelog: changelogSchema,
  }),
  z.object({
    format: z.literal("ENLACE"),
    documentId: idSchema,
    url: httpUrlSchema,
    changelog: changelogSchema,
  }),
]);
export type UploadVersionInput = z.infer<typeof uploadVersionInputSchema>;

/** `restoreVersion`: creates a new version copying the chosen one; history is never rewritten. */
export const restoreVersionInputSchema = z.object({
  documentId: idSchema,
  versionId: idSchema,
  changelog: changelogSchema,
});
export type RestoreVersionInput = z.infer<typeof restoreVersionInputSchema>;

export const listDocumentVersionsInputSchema = z.object({ documentId: idSchema });
export type ListDocumentVersionsInput = z.infer<typeof listDocumentVersionsInputSchema>;

export const getDocumentVersionInputSchema = z.object({
  documentId: idSchema,
  versionId: idSchema,
});
export type GetDocumentVersionInput = z.infer<typeof getDocumentVersionInputSchema>;

// ───────────────────────────── Inputs: links ─────────────────────────────

/** `linkDocument` / `unlinkDocument`: one record at a time. */
export const linkDocumentInputSchema = z.object({
  documentId: idSchema,
  target: documentLinkTargetSchema,
});
export type LinkDocumentInput = z.infer<typeof linkDocumentInputSchema>;
export const unlinkDocumentInputSchema = linkDocumentInputSchema;
export type UnlinkDocumentInput = z.infer<typeof unlinkDocumentInputSchema>;

// ───────────────────────────── Filters ─────────────────────────────

export const DOCUMENT_SORT_FIELDS = [
  "code",
  "title",
  "category",
  "type",
  "status",
  "format",
  "versionNumber",
  "expiresAt",
  "updatedAt",
  "createdAt",
] as const;

export const documentFilterSchema = withSortFields(
  listQuerySchema.extend({
    status: facetOf(documentStatusSchema),
    categoryId: facetOf(idSchema),
    typeId: facetOf(idSchema),
    /** Format of the current version. */
    format: facetOf(documentFormatSchema),
    /** Documents linked to these records. */
    clientId: facetOf(idSchema),
    projectId: facetOf(idSchema),
    tagId: facetOf(idSchema),
    expiresFrom: dateOnlySchema.optional(),
    expiresTo: dateOnlySchema.optional(),
    /** Overview shortcut: expiring within the next N days (30/60/90). */
    expiringWithinDays: z.coerce.number().int().min(1).max(365).optional(),
    /** Included in at least one portal link. */
    shared: z.union([z.boolean(), z.stringbool()]).optional(),
    /** Overview shortcut: drafts untouched for more than 14 days. */
    staleDraft: z.union([z.boolean(), z.stringbool()]).optional(),
  }),
  DOCUMENT_SORT_FIELDS,
);
export type DocumentFilter = z.infer<typeof documentFilterSchema>;
export type DocumentFilterInput = z.input<typeof documentFilterSchema>;

// ───────────────────────────── DTOs ─────────────────────────────

/** Version without its content (history list). */
export const documentVersionRowSchema = z.object({
  id: idSchema,
  documentId: idSchema,
  versionNumber: z.number().int().positive(),
  format: documentFormatSchema,
  /** `ARCHIVO` versions: the stored file. */
  file: fileDtoSchema.nullable(),
  /** `ENLACE` versions: the external URL. */
  url: z.string().nullable(),
  changelog: z.string().nullable(),
  createdBy: userRefSchema,
  createdAt: timestampSchema,
  isCurrent: z.boolean(),
});
export type DocumentVersionRowDTO = z.infer<typeof documentVersionRowSchema>;

/** Version with its markdown content (`MARKDOWN` only), for the viewer and the diff. */
export const documentVersionDetailSchema = documentVersionRowSchema.extend({
  content: z.string().nullable(),
});
export type DocumentVersionDetailDTO = z.infer<typeof documentVersionDetailSchema>;

export const documentLinkSchema = z.object({
  id: idSchema,
  entity: entityRefSchema,
  createdAt: timestampSchema,
});
export type DocumentLinkDTO = z.infer<typeof documentLinkSchema>;

/** Row of the documents table (PRD §8.9.5 "Tabla"). */
export const documentListRowSchema = z.object({
  id: idSchema,
  code: z.string(),
  title: z.string(),
  category: documentCategoryRefSchema,
  type: documentTypeRefSchema,
  status: documentStatusSchema,
  /** Format of the current version; `null` while there is no published version. */
  currentFormat: documentFormatSchema.nullable(),
  currentVersionNumber: z.number().int().positive().nullable(),
  /** "Vinculado a" chips. */
  links: z.array(entityRefSchema),
  expiresAt: dateOnlySchema.nullable(),
  /** Included in at least one active portal link. */
  isShared: z.boolean(),
  tags: z.array(tagChipSchema),
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type DocumentListRowDTO = z.infer<typeof documentListRowSchema>;

export const documentDetailSchema = z.object({
  id: idSchema,
  code: z.string(),
  title: z.string(),
  type: documentTypeRefSchema,
  category: documentCategoryRefSchema,
  summary: z.string().nullable(),
  status: documentStatusSchema,
  effectiveDate: dateOnlySchema.nullable(),
  signedAt: dateOnlySchema.nullable(),
  expiresAt: dateOnlySchema.nullable(),
  alertDaysBefore: z.number().int().nonnegative(),
  currentVersion: documentVersionDetailSchema.nullable(),
  versionCount: z.number().int().nonnegative(),
  /** Markdown draft (autosave); `null` when none. */
  draftContent: z.string().nullable(),
  draftUpdatedAt: timestampSchema.nullable(),
  links: z.array(documentLinkSchema),
  tags: z.array(tagChipSchema),
  isShared: z.boolean(),
  createdBy: userRefSchema.nullable(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});
export type DocumentDetailDTO = z.infer<typeof documentDetailSchema>;

/** Output of `saveDraft`. */
export const saveDraftResultSchema = z.object({
  documentId: idSchema,
  draftUpdatedAt: timestampSchema,
});
export type SaveDraftResultDTO = z.infer<typeof saveDraftResultSchema>;

/** `/documents` overview (PRD §8.9.5 "Overview"). */
export const documentsOverviewSchema = z.object({
  byCategoryAndStatus: z.array(
    z.object({
      category: documentCategoryRefSchema,
      countByStatus: z.partialRecord(documentStatusSchema, z.number().int().positive()),
    }),
  ),
  expiringCounts: z.object({
    days30: z.number().int().nonnegative(),
    days60: z.number().int().nonnegative(),
    days90: z.number().int().nonnegative(),
  }),
  expiringSoon: z.array(documentListRowSchema),
  recent: z.array(documentListRowSchema),
  /** Drafts with no change for more than 14 days. */
  staleDrafts: z.array(documentListRowSchema),
});
export type DocumentsOverviewDTO = z.infer<typeof documentsOverviewSchema>;

export const getDocumentsOverviewInputSchema = z.object({}).strict();
export type GetDocumentsOverviewInput = z.infer<typeof getDocumentsOverviewInputSchema>;

// ───────────────────────────── Services (PRD §12 `documents`) ─────────────────────────────

/**
 * `documents` services. Every service is `fn(ctx, input) → Promise<DTO>` (C9, C11). Failures
 * (INTEGRITY_LOCK on a `FIRMADO` document, VALIDATION on a type rule…) are reported to the action
 * adapter. `archiveDocument(s)`, `listDocuments`, `getDocument`, `listDocumentVersions`,
 * `getDocumentVersion` and `getDocumentsOverview` are the screen counterparts that PRD §12 leaves
 * implicit.
 */
export type DocumentsService<Ctx = unknown> = {
  createDocument: (ctx: Ctx, input: CreateDocumentInput) => Promise<DocumentDetailDTO>;
  updateDocumentMeta: (ctx: Ctx, input: UpdateDocumentMetaInput) => Promise<DocumentDetailDTO>;
  saveDraft: (ctx: Ctx, input: SaveDraftInput) => Promise<SaveDraftResultDTO>;
  publishVersion: (ctx: Ctx, input: PublishVersionInput) => Promise<DocumentDetailDTO>;
  uploadVersion: (ctx: Ctx, input: UploadVersionInput) => Promise<DocumentDetailDTO>;
  restoreVersion: (ctx: Ctx, input: RestoreVersionInput) => Promise<DocumentDetailDTO>;
  setDocumentStatus: (ctx: Ctx, input: SetDocumentStatusInput) => Promise<DocumentDetailDTO>;
  linkDocument: (ctx: Ctx, input: LinkDocumentInput) => Promise<DocumentLinkDTO[]>;
  unlinkDocument: (ctx: Ctx, input: UnlinkDocumentInput) => Promise<DocumentLinkDTO[]>;
  archiveDocument: (ctx: Ctx, input: ArchiveDocumentInput) => Promise<ArchivedRecordDTO>;
  archiveDocuments: (
    ctx: Ctx,
    input: ArchiveDocumentsInput,
  ) => Promise<{ archived: ArchivedRecordDTO[] }>;
  listDocuments: (ctx: Ctx, input: DocumentFilter) => Promise<Paginated<DocumentListRowDTO>>;
  getDocument: (ctx: Ctx, input: DocumentIdInput) => Promise<DocumentDetailDTO>;
  listDocumentVersions: (
    ctx: Ctx,
    input: ListDocumentVersionsInput,
  ) => Promise<DocumentVersionRowDTO[]>;
  getDocumentVersion: (
    ctx: Ctx,
    input: GetDocumentVersionInput,
  ) => Promise<DocumentVersionDetailDTO>;
  getDocumentsOverview: (
    ctx: Ctx,
    input: GetDocumentsOverviewInput,
  ) => Promise<DocumentsOverviewDTO>;
};
