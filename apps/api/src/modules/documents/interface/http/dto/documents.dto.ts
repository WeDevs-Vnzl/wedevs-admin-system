import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DOCUMENT_FORMAT_VALUES, DOCUMENT_STATUS_VALUES } from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import {
  DOCUMENT_LINK_ENTITY_TYPE_VALUES,
  DOCUMENT_SORT_FIELDS,
} from '../../../application/ports/document.repository.port';

/**
 * Request and response shapes of `/documents` (the FE `documents` validators, shape and length only). The
 * type rules, the dates, the transition table, the link targets and the version lock are enforced by the
 * use cases and answer `VALIDATION` / `NOT_FOUND` / `CONFLICT` / `INTEGRITY_LOCK`, so a caller that skips the
 * DTO meets the same rules (lesson B2).
 */

const documentStatus = z.enum(DOCUMENT_STATUS_VALUES);
const documentFormat = z.enum(DOCUMENT_FORMAT_VALUES);
const linkEntityType = z.enum(DOCUMENT_LINK_ENTITY_TYPE_VALUES);
/** Statuses a person can set: `VENCIDO` belongs to the expiry step. */
const userSettableStatus = z.enum([
  'BORRADOR',
  'EN_REVISION',
  'APROBADO',
  'ENVIADO',
  'FIRMADO',
  'ANULADO',
]);

const title = z.string().trim().min(1, 'validation.required').max(200, 'validation.tooLong');
const summary = z.string().trim().max(1000, 'validation.tooLong').nullish();
const changelog = z.string().trim().max(500, 'validation.tooLong').nullish();
const httpUrl = z.string().trim().min(1, 'validation.required').max(2048);

export const documentLinkTargetSchema = z.object({
  entityType: linkEntityType,
  entityId: idSchema,
});
export class DocumentLinkTargetDto extends createZodDto(documentLinkTargetSchema) {}

const initialVersionSchema = z.discriminatedUnion('format', [
  z.object({ format: z.literal('ARCHIVO'), fileId: idSchema, changelog }),
  z.object({ format: z.literal('ENLACE'), url: httpUrl, changelog }),
]);

const metadataShape = {
  title,
  /** The category is derived from the type. */
  typeId: idSchema,
  summary,
  effectiveDate: dateOnlySchema.nullish(),
  /** Only on types with signature. */
  signedAt: dateOnlySchema.nullish(),
  /** Only on types with expiration. */
  expiresAt: dateOnlySchema.nullish(),
  alertDaysBefore: z.number().int().min(0).max(365).default(30),
  tagIds: z.array(idSchema).max(50).default([]),
};

export const createDocumentDtoSchema = z.object({
  ...metadataShape,
  links: z.array(documentLinkTargetSchema).max(30).default([]),
  initialVersion: initialVersionSchema.optional(),
});
export class CreateDocumentDto extends createZodDto(createDocumentDtoSchema) {}

/** `PATCH /documents/{id}`: the whole metadata form, as the FE validator (assumption A5's sibling). */
export const updateDocumentDtoSchema = z.object(metadataShape);
export class UpdateDocumentDto extends createZodDto(updateDocumentDtoSchema) {}

export const setDocumentStatusDtoSchema = z.object({
  status: userSettableStatus,
  signedAt: dateOnlySchema.nullish(),
});
export class SetDocumentStatusDto extends createZodDto(setDocumentStatusDtoSchema) {}

export const archiveDocumentsDtoSchema = z.object({ ids: z.array(idSchema).min(1).max(500) });
export class ArchiveDocumentsDto extends createZodDto(archiveDocumentsDtoSchema) {}

export class DocumentIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
export class DocumentLinkParamsDto extends createZodDto(
  z.object({ id: idSchema, entityType: linkEntityType, entityId: idSchema }),
) {}

const documentListOptions = {
  sortFields: DOCUMENT_SORT_FIELDS,
  defaultSort: { field: 'updatedAt', direction: 'desc' },
  filters: {
    status: documentStatus,
    categoryId: idSchema,
    typeId: idSchema,
    /** Format of the current version. */
    format: documentFormat,
    clientId: idSchema,
    contactId: idSchema,
    projectId: idSchema,
    invoiceId: idSchema,
    paymentId: idSchema,
    expenseId: idSchema,
    tagId: idSchema,
    expiresFrom: dateOnlySchema,
    expiresTo: dateOnlySchema,
    /** Shortcut: expiring within the next N days. */
    expiringWithinDays: z.string().regex(/^[1-9]\d{0,2}$/, 'validation.invalidOption'),
    /** In at least one live share link. */
    shared: z.enum(['true', 'false']),
    /** Shortcut: drafts untouched for more than 14 days. */
    staleDraft: z.enum(['true', 'false']),
  },
} as const;

/** `GET /documents` and `GET /documents/category-counts` (the counts ignore `categoryId`, paging and sort). */
export class ListDocumentsQueryDto extends createListQueryDto(documentListOptions) {}

// ───────────────────────────── Responses ─────────────────────────────

const categoryRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  color: z.string().nullable(),
});
const typeRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  nameEn: z.string().nullable(),
  defaultFormat: documentFormat,
  requiresSignature: z.boolean(),
  hasExpiration: z.boolean(),
});
const tagChipSchema = z.object({ id: z.string(), name: z.string(), color: z.string() });
const userRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
});
const fileSchema = z.object({
  id: z.string(),
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  status: z.string(),
  uploadedById: z.string(),
  createdAt: timestampSchema,
});

export const documentLinkSchema = z.object({
  id: z.string(),
  entity: entityRefResponseSchema,
  createdAt: timestampSchema,
});
export class DocumentLinkDto extends createZodDto(documentLinkSchema) {}
export class EntityRefResponseDto extends createZodDto(z.object(entityRefResponseSchema.shape)) {}

export const documentVersionSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  versionNumber: z.number().int(),
  format: documentFormat,
  file: fileSchema.nullable(),
  url: z.string().nullable(),
  changelog: z.string().nullable(),
  createdBy: userRefSchema,
  createdAt: timestampSchema,
  isCurrent: z.boolean(),
  /** Raw markdown: the FE sanitizes it when rendering (C4). */
  content: z.string().nullable(),
});

export const documentListRowSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  category: categoryRefSchema,
  type: typeRefSchema,
  status: documentStatus,
  /** Format of the current version; `null` while there is no published version. */
  currentFormat: documentFormat.nullable(),
  currentVersionNumber: z.number().int().nullable(),
  links: z.array(entityRefResponseSchema),
  expiresAt: dateOnlySchema.nullable(),
  isShared: z.boolean(),
  tags: z.array(tagChipSchema),
  updatedAt: timestampSchema,
  archivedAt: timestampSchema.nullable(),
});

export const documentListResponseSchema = z.object({
  items: z.array(documentListRowSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
});
export class DocumentListResponseDto extends createZodDto(documentListResponseSchema) {}

export const documentDetailSchema = z.object({
  id: z.string(),
  code: z.string(),
  title: z.string(),
  type: typeRefSchema,
  category: categoryRefSchema,
  summary: z.string().nullable(),
  status: documentStatus,
  effectiveDate: dateOnlySchema.nullable(),
  signedAt: dateOnlySchema.nullable(),
  expiresAt: dateOnlySchema.nullable(),
  alertDaysBefore: z.number().int(),
  currentVersion: documentVersionSchema.nullable(),
  versionCount: z.number().int(),
  /** Markdown draft (last explicit save, DT-139); `null` when none. */
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
export class DocumentDetailDto extends createZodDto(documentDetailSchema) {}

export const archivedDocumentSchema = z.object({ id: z.string(), archivedAt: timestampSchema });
export class ArchivedDocumentDto extends createZodDto(archivedDocumentSchema) {}
export class ArchivedDocumentsDto extends createZodDto(
  z.object({ archived: z.array(archivedDocumentSchema) }),
) {}
