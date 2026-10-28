import type { CurrentUser } from '../../../../shared/application/current-user';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { FileAccessRegistry } from '../file-access.registry';
import type { FileAccessClaim } from '../ports/file-access.port';
import type { FileRepository } from '../ports/file.repository.port';

export interface ReservedFile {
  readonly id: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

/**
 * Application API other contexts call while attaching a file (invoice, payment, expense, document
 * version, note). Valid only inside the caller's unit of work: it takes the `File` row lock that
 * `DeleteFile` also takes, so the attach and a concurrent delete serialize, and the caller's write
 * commits with the lock held (C23). The file must be `READY`, not deleted, and either uploaded by the
 * caller or already claimed by a resource the caller can read. Anything else answers `NOT_FOUND` (C14).
 */
export class ReserveFileForAttachment {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly files: FileRepository,
    private readonly registry: FileAccessRegistry,
  ) {}

  async execute(user: CurrentUser, fileId: string): Promise<ReservedFile> {
    const file = await this.files.lockForUpdate(fileId);
    if (!file || file.status !== 'READY') throw new NotFoundError();

    if (file.uploadedById !== user.userId) {
      const claims = await this.registry.claimsFor(file.id);
      if (!claims.some((claim) => this.grants(user, claim))) throw new NotFoundError();
    }
    return {
      id: file.id,
      originalName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
    };
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
