import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { IdGeneratorPort } from '../../../../shared/application/ports/id-generator.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import { createPendingFile } from '../../domain/file';
import {
  checkUpload,
  isSafeFileName,
  resolveDeclaredMime,
  type UploadContext,
} from '../../domain/upload-rules';
import type { FileRepository } from '../ports/file.repository.port';
import type { FileStoragePort } from '../ports/file-storage.port';
import { assertCanUploadFiles } from '../upload-permission';

export { UPLOAD_CONTEXT_VALUES, isSafeFileName } from '../../domain/upload-rules';

/** Lifetime of the signed upload parameters (C23). */
export const UPLOAD_INTENT_TTL_MS = 5 * 60 * 1000;

export interface RequestUploadInput {
  readonly name: string;
  /** May be empty: the extension decides then. */
  readonly mime: string;
  readonly size: number;
  readonly context: UploadContext;
}

export interface RequestUploadOutput {
  readonly fileId: string;
  readonly url: string;
  readonly fields: Readonly<Record<string, string>>;
  readonly expiresAt: Date;
}

/** PRD §12 `files.requestUpload`: registers a `PENDING` file and signs the direct upload. */
export class RequestUpload {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly files: FileRepository,
    private readonly storage: FileStoragePort,
    private readonly ids: IdGeneratorPort,
    private readonly clock: ClockPort,
    private readonly uow: UnitOfWorkPort,
  ) {}

  async execute(user: CurrentUser, input: RequestUploadInput): Promise<RequestUploadOutput> {
    assertCanUploadFiles(this.authorization, user);

    if (!isSafeFileName(input.name)) {
      throw new ValidationFailedError({ fieldErrors: { name: ['validation.file.nameInvalid'] } });
    }
    const violation = checkUpload(input, input.context);
    if (violation) {
      const field = violation.key === 'validation.file.typeNotAllowed' ? 'mime' : 'size';
      const key =
        violation.key === 'validation.file.tooLargeMax'
          ? 'validation.file.tooLarge'
          : violation.key;
      throw new ValidationFailedError({ fieldErrors: { [field]: [key] } });
    }

    const now = this.clock.now();
    const file = createPendingFile({
      id: this.ids.next(),
      context: input.context,
      bucket: this.storage.bucket,
      originalName: input.name,
      mimeType: resolveDeclaredMime(input.mime, input.name),
      sizeBytes: input.size,
      uploadedById: user.userId,
      now,
    });
    // Insert first: a stored row without an intent is harmless (PENDING rows are swept by a job).
    await this.uow.run(() => this.files.insert(file));

    const expiresAt = new Date(now.getTime() + UPLOAD_INTENT_TTL_MS);
    const intent = await this.storage.createUploadIntent({
      storageKey: file.storageKey,
      context: input.context,
      expiresAt,
    });
    return { fileId: file.id, url: intent.url, fields: intent.fields, expiresAt: intent.expiresAt };
  }
}
