import { PublishVersion } from '../../../src/modules/documents/application/use-cases/versions/publish-version.use-case';
import {
  GetDocumentVersion,
  ListDocumentVersions,
} from '../../../src/modules/documents/application/use-cases/versions/read-document-versions.use-cases';
import { RestoreVersion } from '../../../src/modules/documents/application/use-cases/versions/restore-version.use-case';
import { SaveDraft } from '../../../src/modules/documents/application/use-cases/versions/save-draft.use-case';
import { UploadVersion } from '../../../src/modules/documents/application/use-cases/versions/upload-version.use-case';
import { DocumentFileAccessResolver } from '../../../src/modules/documents/infrastructure/document-file-access.resolver';
import { admin, member, newDocument, owner, seededWorld, viewer } from '../records/world';
import { InMemoryDocumentVersionRepository } from './fakes/in-memory-document-version.repository';

export { admin, member, newDocument, owner, viewer };

/** The markdown note type of the records world: a document of it opens in the editor. */
export const NOTA = 'dtyp_nota';
/** A type that signs (NDA) and one that is a file by default (also the NDA). */
export const NDA = 'dtyp_nda';

/** The records world plus the version use cases, over the same in-memory documents. */
export function versionsWorld() {
  const world = seededWorld();
  const users = new Map([owner, admin, member, viewer].map((user) => [user.userId, user]));
  const versions = new InMemoryDocumentVersionRepository(world.documents, {
    userRef: (id) => ({ id, name: users.get(id)?.name ?? id, imageUrl: null }),
    file: (id) => {
      const file = world.fileRepo.rows.get(id);
      if (!file) throw new Error(`file ${id} not seeded`);
      return {
        id: file.id,
        originalName: file.originalName,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        status: file.status,
        uploadedById: file.uploadedById,
        createdAt: file.createdAt,
      };
    },
  });
  const { authorization, uow, support, views } = world;
  return {
    ...world,
    versions,
    fileResolver: new DocumentFileAccessResolver(versions),
    saveDraft: new SaveDraft(authorization, uow, support, versions),
    publishVersion: new PublishVersion(authorization, uow, support, versions, views),
    uploadVersion: new UploadVersion(authorization, uow, support, views),
    restoreVersion: new RestoreVersion(authorization, uow, support, versions, views),
    listVersions: new ListDocumentVersions(authorization, support, versions),
    getVersion: new GetDocumentVersion(authorization, support, versions),
  };
}
export type VersionsWorld = ReturnType<typeof versionsWorld>;

/** A live markdown document with `count` published versions (`# v1`, `# v2`, ...). */
export async function markdownDocument(world: VersionsWorld, count = 0, over = {}) {
  const doc = await world.createDocument.execute(
    owner,
    newDocument({ title: 'Nota técnica', typeId: NOTA, ...over }),
  );
  for (let n = 1; n <= count; n++) {
    world.clock.advance(1000);
    await world.publishVersion.execute(owner, {
      documentId: doc.id,
      content: `# v${n}`,
      changelog: `cambio ${n}`,
    });
  }
  return doc;
}

/** The item at `index`, or a failure naming the gap (tests read lists they just filled). */
export function nth<T>(list: readonly T[], index = 0): T {
  const item = list[index];
  if (item === undefined) throw new Error(`expected an item at index ${index}`);
  return item;
}

/** The committed row of a document. */
export function rowOf(world: VersionsWorld, id: string) {
  const row = world.documents.rows.find((candidate) => candidate.id === id);
  if (!row) throw new Error(`document ${id} not found`);
  return row;
}
