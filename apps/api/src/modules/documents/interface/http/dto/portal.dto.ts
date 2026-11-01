import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DOCUMENT_FORMAT_VALUES } from '../../../../../shared/domain/enums';
import {
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
} from '../../../application/use-cases/portal/portal-support';
import { dateOnlySchema, idSchema } from '../../../../../shared/interface/common.schemas';
import { SHARE_LOCALE_VALUES } from '../../../application/ports/share-link.repository.port';

/**
 * Shapes of `/portal/{token}/**` (C22). The `token` and `documentId` params are plain strings: the use case
 * answers the bare `NOT_FOUND` for a malformed one, never `VALIDATION`, so a visitor learns nothing from the
 * shape of a wrong token. A key outside 8-128 characters after trimming is a DTO `VALIDATION`, not an attempt.
 * No response here has a field for a hash, a file key, an author or any id but `documentId`.
 */

const documentFormat = z.enum(DOCUMENT_FORMAT_VALUES);

export class PortalTokenParamsDto extends createZodDto(z.object({ token: z.string() })) {}
export class PortalDocumentParamsDto extends createZodDto(
  z.object({ token: z.string(), documentId: z.string() }),
) {}

export class RecordViewDto extends createZodDto(z.object({ documentId: idSchema.optional() })) {}

export class UnlockDocumentDto extends createZodDto(
  z.object({
    key: z
      .string()
      .trim()
      .min(ACCESS_KEY_MIN_LENGTH, 'validation.tooShort')
      .max(ACCESS_KEY_MAX_LENGTH, 'validation.tooLong'),
  }),
) {}

export class PortalFileQueryDto extends createZodDto(
  z.object({ disposition: z.enum(['inline', 'attachment']).default('inline') }),
) {}

const portalDocument = z.object({
  documentId: z.string(),
  title: z.string(),
  typeName: z.string(),
  typeNameEn: z.string().nullable(),
  versionNumber: z.number().int().positive(),
  versionDate: dateOnlySchema,
  format: documentFormat,
  /** `true` while the document requires a key the visitor has not entered. */
  locked: z.boolean(),
});

export class PortalShareDto extends createZodDto(
  z.object({
    title: z.string(),
    message: z.string().nullable(),
    locale: z.enum(SHARE_LOCALE_VALUES),
    allowDownload: z.boolean(),
    clientName: z.string().nullable(),
    expiresAt: dateOnlySchema.nullable(),
    documents: z.array(portalDocument),
  }),
) {}

export class RecordViewResultDto extends createZodDto(z.object({ recorded: z.literal(true) })) {}

export class UnlockDocumentResultDto extends createZodDto(
  z.object({ documentId: z.string(), unlocked: z.literal(true) }),
) {}

const portalContent = z.discriminatedUnion('format', [
  z.object({ format: z.literal('MARKDOWN'), markdown: z.string() }),
  z.object({ format: z.literal('ENLACE'), url: z.string() }),
  z.object({
    format: z.literal('ARCHIVO'),
    fileName: z.string(),
    mimeType: z.string(),
    sizeBytes: z.number().int().nonnegative(),
    /** How the viewer renders it: embedded PDF, image, or download-only. */
    preview: z.enum(['pdf', 'image', 'none']),
  }),
]);

export class PortalDocumentViewDto extends createZodDto(
  z.object({
    document: portalDocument.extend({ locked: z.literal(false) }),
    content: portalContent,
  }),
) {}
