import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { FileAccessRegistry } from '../file-access.registry';
import type { FileAccessClaim } from '../ports/file-access.port';
import type { FileRepository } from '../ports/file.repository.port';
import type { FileStoragePort } from '../ports/file-storage.port';

/** Lifetime of a signed download URL. */
export const DOWNLOAD_URL_TTL_MS = 60 * 1000;

export interface FileDownloadOutput {
  readonly url: string;
  readonly expiresAt: Date;
}

/**
 * PRD §12 `files.getDownload`. Access follows the owner of the file: the contexts that attached it say
 * what `read` it needs; an unattached file is for its uploader only. Anything not allowed or unknown
 * answers `NOT_FOUND` (C14), never `FORBIDDEN`.
 */
export class GetFileDownload {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly files: FileRepository,
    private readonly registry: FileAccessRegistry,
    private readonly storage: FileStoragePort,
    private readonly clock: ClockPort,
  ) {}

  async execute(
    user: CurrentUser,
    input: { readonly fileId: string },
  ): Promise<FileDownloadOutput> {
    const file = await this.files.findById(input.fileId);
    if (!file || file.status !== 'READY') throw new NotFoundError();

    const claims = await this.registry.claimsFor(file.id);
    let allowed: boolean;
    if (claims.length > 0) {
      allowed = claims.some((claim) => this.grants(user, claim));
    } else {
      // Unattached: only its uploader. A row some context references but no resolver claims fails closed.
      allowed = file.uploadedById === user.userId && !(await this.files.isReferenced(file.id));
    }
    if (!allowed) throw new NotFoundError();

    const expiresAt = new Date(this.clock.now().getTime() + DOWNLOAD_URL_TTL_MS);
    const url = await this.storage.signedDownloadUrl(file.storageKey, {
      fileName: file.originalName,
      expiresAt,
    });
    return { url, expiresAt };
  }

  private grants(user: CurrentUser, claim: FileAccessClaim): boolean {
    if (claim.kind === 'authenticated') return true;
    return this.authorization.can(
      user,
      'read',
      claim.resource,
      claim.ownerId === undefined ? undefined : { ownerId: claim.ownerId },
    );
  }
}
