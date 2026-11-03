import { NoteLinkTargetRegistry } from '../../../src/modules/commercial/application/note-link-target.registry';
import type { UserRef } from '../../../src/modules/documents/application/ports/document.repository.port';
import type {
  SharableDocument,
  ShareLinkRecord,
  ShareDocumentWrite,
} from '../../../src/modules/documents/application/ports/share-link.repository.port';
import { CreateShareLink } from '../../../src/modules/documents/application/use-cases/shares/create-share-link.use-case';
import {
  GetShareLink,
  ListShareAccessLog,
  ListShareLinks,
} from '../../../src/modules/documents/application/use-cases/shares/list-share-links.use-case';
import { MarkExpiredShareLinks } from '../../../src/modules/documents/application/use-cases/shares/mark-expired-share-links.use-case';
import { RevokeShareLink } from '../../../src/modules/documents/application/use-cases/shares/revoke-share-link.use-case';
import { SetShareDocumentAccessKey } from '../../../src/modules/documents/application/use-cases/shares/set-share-document-access-key.use-case';
import {
  ShareSupport,
  ShareViews,
} from '../../../src/modules/documents/application/use-cases/shares/share-support';
import { UpdateShareLink } from '../../../src/modules/documents/application/use-cases/shares/update-share-link.use-case';
import { MatrixAuthorization } from '../../../src/modules/identity/application/matrix-authorization';
import type { CurrentUser } from '../../../src/shared/application/current-user';
import type { DocumentFormat, UserRole } from '../../../src/shared/domain/enums';
import { DEFAULT_LIST_QUERY, type ListQuery } from '../../../src/shared/domain/list-query';
import { FakeNoteTargets } from '../../commercial/notes/fakes/fake-note-targets';
import { FixedClock } from '../../support/fakes/fixed-clock';
import { InMemoryActivityLog } from '../../support/fakes/in-memory-activity-log';
import { InMemoryRowLocks } from '../../support/fakes/in-memory-row-locks';
import { InMemoryUnitOfWork } from '../../support/fakes/in-memory-unit-of-work';
import { SequentialIdGenerator } from '../../support/fakes/sequential-id-generator';
import { FakeShareSecrets } from './fakes/fake-share-secrets';
import { InMemoryShareLinkRepository } from './fakes/in-memory-share-link.repository';

export const APP_URL = 'https://app.example.test';

export const userOf = (role: UserRole, name = role.toLowerCase()): CurrentUser => ({
  userId: `usr_${name}`,
  clerkId: `clerk_${name}`,
  role,
  email: `${name}@example.test`,
  name,
});
export const owner = userOf('OWNER');
export const admin = userOf('ADMIN');
export const member = userOf('MEMBER');
export const viewer = userOf('VIEWER');

export const query = (over: Partial<ListQuery> = {}): ListQuery => ({
  ...DEFAULT_LIST_QUERY,
  ...over,
});

/** Every in-memory port of the share links slice wired with the real use cases and the real matrix. */
export function createWorld() {
  const clock = new FixedClock('2026-10-30T12:00:00.000Z');
  const uow = new InMemoryUnitOfWork();
  const activity = new InMemoryActivityLog(uow);
  const locks = new InMemoryRowLocks(uow);
  const authorization = new MatrixAuthorization();
  const users = new Map<string, CurrentUser>();
  const noteTargets = new FakeNoteTargets();
  const targets = new NoteLinkTargetRegistry(noteTargets);
  const secrets = new FakeShareSecrets(uow);
  const labels = new Map<string, string>();
  const shares = new InMemoryShareLinkRepository(uow, {
    userRef: (id): UserRef => ({ id, name: users.get(id)?.name ?? id, imageUrl: null }),
    clientLabel: (clientId) => labels.get(clientId) ?? null,
  });

  const ids = new SequentialIdGenerator('shr');
  const support = new ShareSupport(shares, targets, secrets, activity, locks, clock, ids);
  const views = new ShareViews(shares, targets, APP_URL, clock);

  return {
    clock,
    uow,
    activity,
    locks,
    authorization,
    noteTargets,
    secrets,
    shares,
    support,
    views,
    createShareLink: new CreateShareLink(authorization, uow, support, views),
    updateShareLink: new UpdateShareLink(authorization, uow, support, views),
    revokeShareLink: new RevokeShareLink(authorization, uow, support, views),
    setAccessKey: new SetShareDocumentAccessKey(authorization, uow, support),
    listShareLinks: new ListShareLinks(authorization, shares, views, clock),
    getShareLink: new GetShareLink(authorization, views),
    listAccessLog: new ListShareAccessLog(authorization, support),
    markExpired: new MarkExpiredShareLinks(uow, support),
    addUser(user: CurrentUser): CurrentUser {
      users.set(user.userId, user);
      return user;
    },
    addClient(id: string, label: string): void {
      noteTargets.add('CLIENT', id, label);
      labels.set(id, label);
    },
    /** A document the link can reference, with `versions` published (the last one is current). */
    seedDocument(
      id: string,
      over: Partial<SharableDocument> & { versions?: number; format?: DocumentFormat } = {},
    ): SharableDocument {
      const { versions = 1, format = 'MARKDOWN', ...rest } = over;
      let currentVersionId: string | null = null;
      for (let n = 1; n <= versions; n += 1) {
        currentVersionId = `${id}_v${n}`;
        shares.versions.set(currentVersionId, { documentId: id, versionNumber: n, format });
      }
      const doc: SharableDocument = {
        id,
        code: `DOC-${id}`,
        title: `Documento ${id}`,
        status: 'APROBADO',
        currentVersionId,
        archived: false,
        ...rest,
      };
      shares.catalog.set(id, doc);
      return doc;
    },
    /** A committed link the use cases cannot produce (an expired one, a revoked one). */
    seedLink(
      over: Partial<ShareLinkRecord> & Pick<ShareLinkRecord, 'id'>,
      documents: readonly ShareDocumentWrite[] = [],
    ): ShareLinkRecord {
      const link: ShareLinkRecord = {
        token: `S${over.id.padStart(42, '0')}`,
        title: `Enlace ${over.id}`,
        message: null,
        clientId: null,
        locale: 'es',
        allowDownload: true,
        expiresAt: null,
        expiredAt: null,
        revokedAt: null,
        viewCount: 0,
        downloadCount: 0,
        lastAccessedAt: null,
        createdAt: clock.now(),
        createdById: owner.userId,
        ...over,
      };
      shares.seedLink(link, documents);
      return link;
    },
  };
}
export type World = ReturnType<typeof createWorld>;

/** A world with the four roles, a client, and two documents (one with three versions). */
export function seededWorld() {
  const world = createWorld();
  for (const user of [owner, admin, member, viewer]) world.addUser(user);
  world.addClient('cli_kairos', 'Kairos');
  world.seedDocument('doc_a', { versions: 3 });
  world.seedDocument('doc_b');
  return world;
}

export const form = (over: Record<string, unknown> = {}) => ({
  title: 'Propuesta Kairos',
  documents: [{ documentId: 'doc_a', versionId: null, requiresAccessKey: false }],
  ...over,
});
