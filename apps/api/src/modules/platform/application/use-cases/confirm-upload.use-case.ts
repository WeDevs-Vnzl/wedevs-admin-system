import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { NotFoundError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import {
  contextOfStorageKey,
  isUtf8Text,
  verifyContentType,
  type StoredFile,
} from '../../domain/file';
import { UPLOAD_RULES, resolveDeclaredMime } from '../../domain/upload-rules';
import type { ContentSnifferPort } from '../ports/content-sniffer.port';
import type { FileRepository } from '../ports/file.repository.port';
import type { FileStoragePort } from '../ports/file-storage.port';
import { assertCanUploadFiles, type CleanupFailureHandler } from '../upload-permission';

/** Magic bytes of every supported format sit within the first 4100 bytes (what `file-type` reads). */
export const SNIFF_HEAD_BYTES = 4100;

/** PRD §12 `files.confirmUpload`: verifies the uploaded bytes and flips the file to `READY` (C23). */
export class ConfirmUpload {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly files: FileRepository,
    private readonly storage: FileStoragePort,
    private readonly sniffer: ContentSnifferPort,
    private readonly activity: ActivityLogPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clock: ClockPort,
    private readonly onCleanupFailure: CleanupFailureHandler,
  ) {}

  async execute(user: CurrentUser, input: { readonly fileId: string }): Promise<StoredFile> {
    assertCanUploadFiles(this.authorization, user);

    const file = await this.files.findById(input.fileId);
    if (!file || file.uploadedById !== user.userId) throw new NotFoundError();
    if (file.status === 'READY') return file; // idempotent
    const context = contextOfStorageKey(file.storageKey);
    if (!context) throw new NotFoundError();

    const info = await this.storage.getObjectInfo(file.storageKey);
    if (!info) {
      // The browser has not uploaded yet: keep the row PENDING so the client can retry.
      throw new ValidationFailedError({ fieldErrors: { file: ['validation.file.notUploaded'] } });
    }
    if (info.bytes <= 0) return this.reject(file, { size: ['validation.file.empty'] });
    if (info.bytes > UPLOAD_RULES[context].maxBytes) {
      return this.reject(file, { size: ['validation.file.tooLarge'] });
    }

    const head = await this.storage.readHead(file.storageKey, SNIFF_HEAD_BYTES);
    const sniffed = await this.sniffer.sniff(head);
    const verdict = verifyContentType({
      context,
      declaredMime: resolveDeclaredMime(file.mimeType, file.originalName),
      sniffed: sniffed?.mime ?? null,
      headIsText: isUtf8Text(head),
    });
    if (!verdict.ok) return this.reject(file, { mime: ['validation.file.typeNotAllowed'] });

    const ready: StoredFile = {
      ...file,
      status: 'READY',
      sizeBytes: info.bytes,
      mimeType: verdict.mimeType,
    };
    const transitioned = await this.uow.run(async () => {
      const changed = await this.files.markReady(file.id, {
        sizeBytes: ready.sizeBytes,
        mimeType: ready.mimeType,
      });
      if (changed) {
        await this.activity.record({
          actor: actorOf(user),
          action: 'UPLOAD',
          entityType: 'FILE',
          entityId: file.id,
          entityLabel: file.originalName,
          metadata: { sizeBytes: ready.sizeBytes, mimeType: ready.mimeType },
        });
      }
      return changed;
    });
    if (transitioned) return ready;
    const current = await this.files.findById(file.id);
    if (!current) throw new NotFoundError();
    return current;
  }

  /** Soft-deletes the row (committed first), destroys the asset, then fails with `VALIDATION`. */
  private async reject(file: StoredFile, fieldErrors: Record<string, string[]>): Promise<never> {
    const at = this.clock.now();
    await this.uow.run(() => this.files.softDelete(file.id, at));
    try {
      await this.storage.destroy(file.storageKey);
    } catch (error) {
      this.onCleanupFailure(error, { fileId: file.id, storageKey: file.storageKey });
    }
    throw new ValidationFailedError({ fieldErrors });
  }
}
