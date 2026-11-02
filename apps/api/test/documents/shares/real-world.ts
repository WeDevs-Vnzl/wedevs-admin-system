// The share-link use cases over real adapters, for the concurrency specs. The `Gate` / `interleave` helpers are
// the deterministic ones of BE-2; the hooks decorate the repository, the row locks and the unit of work so the
// same spec can run with and without the lock (the unlocked behavior).
import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import { PrismaNoteTargetAdapter } from '../../../src/modules/commercial/infrastructure/prisma-note-target.adapter';
import type { ShareLinkRepository } from '../../../src/modules/documents/application/ports/share-link.repository.port';
import { CreateShareLink } from '../../../src/modules/documents/application/use-cases/shares/create-share-link.use-case';
import { MarkExpiredShareLinks } from '../../../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { RevokeShareLink } from '../../../src/modules/documents/application/use-cases/shares/revoke-share-link.use-case';
import { SetShareDocumentAccessKey } from '../../../src/modules/documents/application/use-cases/shares/set-share-document-access-key.use-case';
import {
  ShareSupport,
  ShareViews,
} from '../../../src/modules/documents/application/use-cases/shares/share-support';
import { UpdateShareLink } from '../../../src/modules/documents/application/use-cases/shares/update-share-link.use-case';
import { NodeShareSecrets } from '../../../src/modules/documents/infrastructure/node-share-secrets';
import { PrismaShareLinkRepository } from '../../../src/modules/documents/infrastructure/prisma-share-link.repository';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { RowLocksPort } from '../../../src/shared/application/ports/row-locks.port';
import type { UnitOfWorkPort } from '../../../src/shared/application/ports/unit-of-work.port';
import { CuidGenerator } from '../../../src/shared/infrastructure/id-generator.adapter';
import { PrismaActivityLog } from '../../../src/shared/infrastructure/prisma/prisma-activity-log';
import { PrismaClientMetricsWriter } from '../../../src/shared/infrastructure/prisma/prisma-client-metrics-writer';
import { PrismaRowLocks } from '../../../src/shared/infrastructure/prisma/prisma-row-locks';
import { PrismaUnitOfWork } from '../../../src/shared/infrastructure/prisma/prisma-unit-of-work';
import type { PrismaService } from '../../../src/shared/infrastructure/prisma/prisma.service';
import { TransactionHost } from '../../../src/shared/infrastructure/prisma/transaction-host';
import { SystemClock } from '../../../src/shared/infrastructure/system-clock.adapter';

export { Gate, gated, interleave } from '../../commercial/concurrency/world';
export { noLocks, readCommitted } from '../concurrency/world';

export interface ShareWorldHooks {
  /** Decorates the share repository, e.g. to pause a transaction at a `Gate` before a write. */
  shares?: (repository: ShareLinkRepository) => ShareLinkRepository;
  /** Decorates the row locks, e.g. with a no-op (the unlocked behavior). */
  locks?: (locks: RowLocksPort) => RowLocksPort;
  /** Decorates the unit of work, e.g. to force `ReadCommitted` (the unlocked behavior). */
  uow?: (uow: UnitOfWorkPort) => UnitOfWorkPort;
}

export const TEST_APP_URL = 'https://app.example.test';

/** The share-link use cases over real adapters, sharing one `TransactionHost` per world. */
export function buildShareWorld(service: PrismaService, hooks: ShareWorldHooks = {}) {
  const host = new TransactionHost(service);
  const uow = (hooks.uow ?? ((u) => u))(new PrismaUnitOfWork(host));
  const authorization = new MatrixAuthorization();
  const shares = (hooks.shares ?? ((s) => s))(new PrismaShareLinkRepository(host));
  const locks = (hooks.locks ?? ((l) => l))(new PrismaRowLocks(host));
  const targets = new NoteLinkTargetRegistry(new PrismaNoteTargetAdapter(host));
  const secrets = new NodeShareSecrets({
    unlockSecret: 'fake-unlock-secret-not-real-0000000000',
    ipSalt: 'fake-ip-salt-not-real-000000000000000',
  });
  const clock = new SystemClock();
  const support = new ShareSupport(
    shares,
    targets,
    secrets,
    new PrismaActivityLog(host, new PrismaClientMetricsWriter(host)),
    locks,
    clock,
    new CuidGenerator(),
  );
  const views = new ShareViews(shares, targets, TEST_APP_URL, clock);
  return {
    host,
    uow,
    shares,
    support,
    createShareLink: new CreateShareLink(authorization, uow, support, views),
    updateShareLink: new UpdateShareLink(authorization, uow, support, views),
    revokeShareLink: new RevokeShareLink(authorization, uow, support, views),
    setAccessKey: new SetShareDocumentAccessKey(authorization, uow, support),
    markExpired: new MarkExpiredShareLinks(uow, support),
  };
}
export type ShareWorld = ReturnType<typeof buildShareWorld>;
