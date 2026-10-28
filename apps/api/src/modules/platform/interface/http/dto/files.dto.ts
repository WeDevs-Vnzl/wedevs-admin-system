import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { FILE_STATUS_VALUES } from '../../../../../shared/domain/enums';
import { idSchema, timestampSchema } from '../../../../../shared/interface/common.schemas';
import {
  UPLOAD_CONTEXT_VALUES,
  isSafeFileName,
} from '../../../application/use-cases/request-upload.use-case';

/**
 * Shape of the request only. The context rules (type allowlist, size limit) are applied by the
 * `RequestUpload` use case, which answers `VALIDATION` with `fieldErrors` keyed `mime` / `size`.
 */
export const requestUploadSchema = z.object({
  name: z
    .string()
    .min(1, 'validation.file.nameInvalid')
    .max(255, 'validation.file.nameInvalid')
    .refine(isSafeFileName, { message: 'validation.file.nameInvalid' }),
  /** May be empty: the extension decides then. */
  mime: z.string(),
  /** Size in bytes (not money, so a plain integer). */
  size: z.number().int(),
  context: z.enum(UPLOAD_CONTEXT_VALUES),
});

export const confirmUploadSchema = z.object({ fileId: idSchema });

export const fileIdParamsSchema = z.object({ id: idSchema });

export const uploadIntentResponseSchema = z.object({
  fileId: idSchema,
  /** Cloudinary endpoint the browser POSTs the multipart form to. */
  url: z.string(),
  /** Signed form fields to send together with the `file` part. */
  fields: z.record(z.string(), z.string()),
  /** The signed parameters stop being accepted at this instant (5 minutes). */
  expiresAt: timestampSchema,
});

export const fileResponseSchema = z.object({
  id: idSchema,
  originalName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(FILE_STATUS_VALUES),
  uploadedById: idSchema,
  createdAt: timestampSchema,
});

export class RequestUploadDto extends createZodDto(requestUploadSchema) {}
export class ConfirmUploadDto extends createZodDto(confirmUploadSchema) {}
export class FileIdParamsDto extends createZodDto(fileIdParamsSchema) {}
export class UploadIntentResponseDto extends createZodDto(uploadIntentResponseSchema) {}
export class FileResponseDto extends createZodDto(fileResponseSchema) {}
