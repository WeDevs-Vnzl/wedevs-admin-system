import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { FileRepository } from '../ports/file.repository.port';
import type { FileDisposition, FileStoragePort } from '../ports/file-storage.port';

export interface FileDeliveryUrl {
  readonly url: string;
  readonly expiresAt: Date;
  readonly fileName: string;
  readonly mimeType: string;
}

/**
 * Application API other contexts call once they authorized the caller by their own means (the portal, by
 * share token and access key). It has no route and no `can()`: it is reachable only from application code
 * (C23). The file must be `READY` and live; anything else is `NOT_FOUND`, and the URL is signed per call
 * with the caller's own lifetime.
 */
export class IssueFileDeliveryUrl {
  constructor(
    private readonly files: FileRepository,
    private readonly storage: FileStoragePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    fileId: string,
    options: { readonly disposition?: FileDisposition; readonly ttlMs: number },
  ): Promise<FileDeliveryUrl> {
    if (!Number.isFinite(options.ttlMs) || options.ttlMs <= 0) {
      throw new RangeError('ttlMs must be a positive number of milliseconds');
    }
    const file = await this.files.findById(fileId);
    if (!file || file.status !== 'READY') throw new NotFoundError();

    const expiresAt = new Date(this.clock.now().getTime() + options.ttlMs);
    const url = await this.storage.signedDownloadUrl(file.storageKey, {
      fileName: file.originalName,
      expiresAt,
      disposition: options.disposition ?? 'attachment',
    });
    return { url, expiresAt, fileName: file.originalName, mimeType: file.mimeType };
  }
}
