import { actorOf } from '../../../../shared/application/actor';
import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ActivityLogPort } from '../../../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import type { UnitOfWorkPort } from '../../../../shared/application/ports/unit-of-work.port';
import { IntegrityLockedError, NotFoundError } from '../../../../shared/domain/domain-error';
import type { FileAccessRegistry } from '../file-access.registry';
import type { FileRepository } from '../ports/file.repository.port';
import type { FileStoragePort } from '../ports/file-storage.port';
import { assertCanUploadFiles, type CleanupFailureHandler } from '../upload-permission';

/**
 * PRD §12 `files.delete`: the uploader's own unattached file, for a caller who can still upload (DT-109). Someone else's file is a plain `NOT_FOUND`
 * (C14); an attached one is `INTEGRITY_LOCK`. The asset is destroyed after the commit; if that fails the
 * row is already gone and the cleanup job retries.
 */
export class DeleteFile {
  constructor(
    private readonly authorization: AuthorizationPort,
    private readonly files: FileRepository,
    private readonly registry: FileAccessRegistry,
    private readonly storage: FileStoragePort,
    private readonly activity: ActivityLogPort,
    private readonly uow: UnitOfWorkPort,
    private readonly clock: ClockPort,
    private readonly onCleanupFailure: CleanupFailureHandler,
  ) {}

  async execute(user: CurrentUser, input: { readonly fileId: string }): Promise<void> {
    assertCanUploadFiles(this.authorization, user);

    const at = this.clock.now();
    // Ownership, claims and references are checked inside the unit of work, next to the write, under the
    // same row lock `ReserveFileForAttachment` takes: an attach and a delete of one file serialize (C23).
    const file = await this.uow.run(async () => {
      const found = await this.files.lockForUpdate(input.fileId);
      if (!found || found.uploadedById !== user.userId) throw new NotFoundError();
      const claims = await this.registry.claimsFor(found.id);
      if (claims.length > 0 || (await this.files.isReferenced(found.id))) {
        throw new IntegrityLockedError();
      }
      const deleted = await this.files.softDelete(found.id, at);
      if (!deleted) throw new NotFoundError();
      await this.activity.record({
        actor: actorOf(user),
        action: 'DELETE',
        entityType: 'FILE',
        entityId: found.id,
        entityLabel: found.originalName,
      });
      return found;
    });

    try {
      await this.storage.destroy(file.storageKey);
    } catch (error) {
      this.onCleanupFailure(error, { fileId: file.id, storageKey: file.storageKey });
    }
  }
}
