import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { idSchema, timestampSchema } from '../../../../../shared/interface/common.schemas';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import type { UploadVersionInput } from '../../../application/use-cases/versions/upload-version.use-case';
import { VERSION_CONTENT_MAX } from '../../../application/use-cases/versions/version-input';
import { documentVersionSchema } from './documents.dto';

/**
 * Request and response shapes of the version routes (the FE `documents` validators, shape and length only).
 * The lock, the markdown-only rule, the `http(s)` URL and the held-file rule are enforced by the use cases, so
 * a caller that skips the DTO meets the same rules (lesson B2).
 */

const changelog = z.string().trim().max(500, 'validation.tooLong').nullish();
const httpUrl = z.string().trim().min(1, 'validation.required').max(2048);

export class DocumentVersionParamsDto extends createZodDto(
  z.object({ id: idSchema, versionId: idSchema }),
) {}

export class SaveDraftDto extends createZodDto(
  z.object({ content: z.string().max(VERSION_CONTENT_MAX, 'validation.tooLong') }),
) {}

/** The editor's latest text, saved or not; without it the stored draft is published. */
export class PublishVersionDto extends createZodDto(
  z.object({
    content: z.string().min(1, 'validation.required').max(VERSION_CONTENT_MAX).optional(),
    changelog,
  }),
) {}

/**
 * `POST /documents/{id}/versions`: a `READY` file (`ARCHIVO` + `fileId`) or an `http(s)` link (`ENLACE` + `url`).
 * Flat on purpose: a union cannot be a DTO class. `toUploadVersionInput` narrows it for the use case.
 */
export class UploadVersionDto extends createZodDto(
  z
    .object({
      format: z.enum(['ARCHIVO', 'ENLACE']),
      fileId: idSchema.optional(),
      url: httpUrl.optional(),
      changelog,
    })
    .superRefine((value, ctx) => {
      const field = value.format === 'ARCHIVO' ? 'fileId' : 'url';
      if (!value[field]) {
        ctx.addIssue({ code: 'custom', path: [field], message: 'validation.required' });
      }
    }),
) {}

/** The use case input for the body, once the schema guaranteed the field its format needs. */
export function toUploadVersionInput(
  documentId: string,
  body: UploadVersionDto,
): UploadVersionInput {
  if (body.format === 'ARCHIVO' && body.fileId) {
    return {
      format: 'ARCHIVO',
      fileId: body.fileId,
      changelog: body.changelog ?? null,
      documentId,
    };
  }
  if (body.format === 'ENLACE' && body.url) {
    return { format: 'ENLACE', url: body.url, changelog: body.changelog ?? null, documentId };
  }
  throw new ValidationFailedError({
    fieldErrors: { [body.format === 'ARCHIVO' ? 'fileId' : 'url']: ['validation.required'] },
  });
}

export class RestoreVersionDto extends createZodDto(z.object({ changelog })) {}

export class SaveDraftResponseDto extends createZodDto(
  z.object({ documentId: z.string(), draftUpdatedAt: timestampSchema }),
) {}

export class DocumentVersionRowDto extends createZodDto(
  documentVersionSchema.omit({ content: true }),
) {}
export class DocumentVersionDetailDto extends createZodDto(documentVersionSchema) {}
