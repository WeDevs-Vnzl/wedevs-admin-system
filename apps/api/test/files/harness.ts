import { FileAccessRegistry } from '../../src/modules/platform/application/file-access.registry';
import { ConfirmUpload } from '../../src/modules/platform/application/use-cases/confirm-upload.use-case';
import { DeleteFile } from '../../src/modules/platform/application/use-cases/delete-file.use-case';
import { GetFileDownload } from '../../src/modules/platform/application/use-cases/get-file-download.use-case';
import { GetFileSummary } from '../../src/modules/platform/application/use-cases/get-file-summary.use-case';
import { ReserveFileForAttachment } from '../../src/modules/platform/application/use-cases/reserve-file-for-attachment.use-case';
import { RequestUpload } from '../../src/modules/platform/application/use-cases/request-upload.use-case';
import type { CurrentUser } from '../../src/shared/application/current-user';
import { FakeAuthorization } from '../support/fakes/fake-authorization';
import { FixedClock } from '../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../support/fakes/in-memory-activity-log';
import { InMemoryFileStorage } from '../support/fakes/in-memory-file-storage';
import { InMemoryUnitOfWork } from '../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../support/fakes/sequential-id-generator';
import { FakeContentSniffer } from './fake-content-sniffer';
import { InMemoryFileRepository } from './in-memory-file.repository';

export const member: CurrentUser = {
  userId: 'usr_member',
  clerkId: 'clerk_member',
  role: 'MEMBER',
  email: 'member@example.test',
  name: 'Member',
};
export const other: CurrentUser = { ...member, userId: 'usr_other', clerkId: 'clerk_other' };
export const viewer: CurrentUser = { ...member, userId: 'usr_viewer', role: 'VIEWER' };

/** Mirrors Q-BE1-3: only the Viewer lacks `create` on every attachable resource. */
export const viewerCannotCreate = new FakeAuthorization({
  policy: (user, action) => !(user.role === 'VIEWER' && action !== 'read'),
});

export function buildFilesHarness(authorization = viewerCannotCreate) {
  const clock = new FixedClock('2026-10-25T10:00:00.000Z');
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const files = new InMemoryFileRepository();
  const storage = new InMemoryFileStorage();
  const registry = new FileAccessRegistry();
  const ids = new SequentialIdGenerator('fil');
  const cleanupFailures: unknown[] = [];
  const onCleanupFailure = (error: unknown) => cleanupFailures.push(error);
  return {
    clock,
    uow,
    activity,
    files,
    storage,
    registry,
    cleanupFailures,
    requestUpload: new RequestUpload(authorization, files, storage, ids, clock, uow),
    confirmUpload: new ConfirmUpload(
      authorization,
      files,
      storage,
      new FakeContentSniffer(),
      activity,
      uow,
      clock,
      onCleanupFailure,
    ),
    getDownload: new GetFileDownload(authorization, files, registry, storage, clock),
    deleteFile: new DeleteFile(
      authorization,
      files,
      registry,
      storage,
      activity,
      uow,
      clock,
      onCleanupFailure,
    ),
    getSummary: new GetFileSummary(authorization, files, registry),
    reserveFile: new ReserveFileForAttachment(authorization, files, registry),
  };
}

export type FilesHarness = ReturnType<typeof buildFilesHarness>;
