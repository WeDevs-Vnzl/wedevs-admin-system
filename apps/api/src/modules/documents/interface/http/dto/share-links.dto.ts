import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DOCUMENT_FORMAT_VALUES, DOCUMENT_STATUS_VALUES } from '../../../../../shared/domain/enums';
import { SHARE_EVENT_VALUES } from '../../../../../shared/domain/enums';
import {
  dateOnlySchema,
  idSchema,
  timestampSchema,
} from '../../../../../shared/interface/common.schemas';
import { entityRefResponseSchema } from '../../../../../shared/interface/error-envelope';
import { createListQueryDto } from '../../../../../shared/interface/list-query.dto';
import {
  SHARE_ACCESS_LOG_SORT_FIELDS,
  SHARE_LOCALE_VALUES,
  SHARE_SORT_FIELDS,
} from '../../../application/ports/share-link.repository.port';
import { ACCESS_KEY_ACTION_VALUES } from '../../../application/use-cases/shares/set-share-document-access-key.use-case';

/**
 * Request and response shapes of `/share-links` (the FE `shares` validators, shape and length only). The
 * references, the dates, the revoked rule and the key combinations are enforced by the use cases and answer
 * `VALIDATION` / `NOT_FOUND` / `CONFLICT` / `INTEGRITY_LOCK`, so a caller that skips the DTO meets the same
 * rules (lesson B2). No response schema here has a field for a key or a hash: the clear key exists only in
 * `generatedKeys` and `accessKey` of a mutation result (C22, DT-45).
 */

const shareStatus = z.enum(['ACTIVE', 'REVOKED', 'EXPIRED']);
const shareEvent = z.enum(SHARE_EVENT_VALUES);
const shareLocale = z.enum(SHARE_LOCALE_VALUES);
const accessKeyAction = z.enum(ACCESS_KEY_ACTION_VALUES);
const documentFormat = z.enum(DOCUMENT_FORMAT_VALUES);
const documentStatus = z.enum(DOCUMENT_STATUS_VALUES);

// ───────────────────────────── Requests ─────────────────────────────

const shareDocumentInput = z.object({
  documentId: idSchema,
  /** `null` = always the current version. */
  versionId: idSchema.nullable().default(null),
  /** When `true` and the document has no key yet, a key is generated and returned once. */
  requiresAccessKey: z.boolean().default(false),
});

const text = (max: number) => z.string().trim().max(max, 'validation.tooLong');

/** `POST /share-links`, and `PATCH /share-links/{id}` with the whole form (A5). */
export const shareLinkFormSchema = z.object({
  title: text(200).min(1, 'validation.required'),
  message: text(2000).nullish(),
  /** Personalizes the portal header. */
  clientId: idSchema.nullish(),
  documents: z.array(shareDocumentInput).min(1).max(50),
  allowDownload: z.boolean().default(true),
  locale: shareLocale.default('es'),
  /** Last valid day (Caracas); no value = never expires. */
  expiresAt: dateOnlySchema.nullish(),
});
export class ShareLinkFormDto extends createZodDto(shareLinkFormSchema) {}

export class ShareLinkIdParamsDto extends createZodDto(z.object({ id: idSchema })) {}
export class ShareLinkDocumentParamsDto extends createZodDto(
  z.object({ id: idSchema, documentId: idSchema }),
) {}

export class SetShareAccessKeyDto extends createZodDto(z.object({ action: accessKeyAction })) {}

export class ListShareLinksQueryDto extends createListQueryDto({
  sortFields: SHARE_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    status: shareStatus,
    clientId: idSchema,
    /** Links that include this document. */
    documentId: idSchema,
    /** Links with at least one key-protected document. */
    hasAccessKeys: z.enum(['true', 'false']),
    createdFrom: dateOnlySchema,
    createdTo: dateOnlySchema,
  },
}) {}

export class ListShareAccessLogQueryDto extends createListQueryDto({
  sortFields: SHARE_ACCESS_LOG_SORT_FIELDS,
  defaultSort: { field: 'createdAt', direction: 'desc' },
  filters: {
    event: shareEvent,
    documentId: idSchema,
    from: dateOnlySchema,
    to: dateOnlySchema,
  },
}) {}

// ───────────────────────────── Responses ─────────────────────────────

const counter = z.number().int().nonnegative();
const countersSchema = z.object({
  viewCount: counter,
  downloadCount: counter,
  unlockCount: counter,
  failedUnlockCount: counter,
});
const userRefSchema = z.object({
  id: z.string(),
  name: z.string(),
  imageUrl: z.string().nullable(),
});

const shareDocumentSchema = z.object({
  /** `{ id, code, label (title), type: "DOCUMENT" }`. */
  document: entityRefResponseSchema,
  documentStatus,
  /** Pinned version; `null` follows the latest. */
  versionId: z.string().nullable(),
  isLatest: z.boolean(),
  /** The version a visitor currently gets. */
  versionNumber: z.number().int().nullable(),
  format: documentFormat.nullable(),
  order: z.number().int().nonnegative(),
  /** Whether a key is required; the key and its hash are never returned. */
  requiresAccessKey: z.boolean(),
  /** When the key was last generated or regenerated; `null` without a key. */
  accessKeyUpdatedAt: timestampSchema.nullable(),
  counters: countersSchema,
});

export const shareLinkDetailSchema = z.object({
  id: z.string(),
  /** Part of the public URL; the owner needs it to copy the link and build the QR code. */
  token: z.string(),
  /** `<APP_URL>/s/<token>`. */
  url: z.string(),
  title: z.string(),
  message: z.string().nullable(),
  client: entityRefResponseSchema.nullable(),
  locale: shareLocale,
  allowDownload: z.boolean(),
  expiresAt: dateOnlySchema.nullable(),
  revokedAt: timestampSchema.nullable(),
  /** Derived from `revokedAt`, `expiresAt` and the Caracas business day. */
  status: shareStatus,
  counters: countersSchema,
  lastAccessedAt: timestampSchema.nullable(),
  documents: z.array(shareDocumentSchema),
  createdBy: userRefSchema,
  createdAt: timestampSchema,
});
export class ShareLinkDetailDto extends createZodDto(shareLinkDetailSchema) {}

/** A freshly generated key: the only place besides `SetShareAccessKeyResultDto` a clear key appears. */
const generatedAccessKeySchema = z.object({ documentId: z.string(), accessKey: z.string() });

export class ShareLinkMutationResultDto extends createZodDto(
  z.object({ share: shareLinkDetailSchema, generatedKeys: z.array(generatedAccessKeySchema) }),
) {}

export class SetShareAccessKeyResultDto extends createZodDto(
  z.object({
    shareLinkId: z.string(),
    documentId: z.string(),
    action: accessKeyAction,
    requiresAccessKey: z.boolean(),
    accessKeyUpdatedAt: timestampSchema.nullable(),
    /** The clear key: non-null only for `generate` and `regenerate`, and only in this response. */
    accessKey: z.string().nullable(),
  }),
) {}

const shareLinkListRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  client: entityRefResponseSchema.nullable(),
  documentCount: counter,
  /** Documents of the link that require a key. */
  protectedDocumentCount: counter,
  status: shareStatus,
  expiresAt: dateOnlySchema.nullable(),
  counters: countersSchema,
  lastAccessedAt: timestampSchema.nullable(),
  createdBy: userRefSchema,
  createdAt: timestampSchema,
});

const page = {
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  pageCount: z.number().int(),
};

export class ShareLinkListResponseDto extends createZodDto(
  z.object({ items: z.array(shareLinkListRowSchema), ...page }),
) {}

/** A row of the access table. The IP is never exposed: `visitor` is a 12-character prefix of the salted hash. */
const shareAccessLogRowSchema = z.object({
  id: z.string(),
  shareLinkId: z.string(),
  event: shareEvent,
  documentId: z.string().nullable(),
  documentTitle: z.string().nullable(),
  visitor: z.string().max(12),
  userAgent: z.string().nullable(),
  createdAt: timestampSchema,
});

export class ShareAccessLogResponseDto extends createZodDto(
  z.object({ items: z.array(shareAccessLogRowSchema), ...page }),
) {}
