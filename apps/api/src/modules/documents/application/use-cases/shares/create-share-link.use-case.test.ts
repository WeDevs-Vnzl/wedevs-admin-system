import { describe, expect, it } from 'vitest';
import { must } from '../../../../../../test/documents/shares/must';
import { SHARE_TOKEN_LENGTH } from '../../../domain';
import { shareUrl } from './share-support';
import {
  admin,
  APP_URL,
  form,
  member,
  owner,
  seededWorld,
  viewer,
} from '../../../../../../test/documents/shares/world';

const KEYED = [
  { documentId: 'doc_a', versionId: null, requiresAccessKey: true },
  { documentId: 'doc_b', versionId: null, requiresAccessKey: false },
];

describe('createShareLink (HU-22 CA1)', () => {
  it('creates a link with the token, the URL from APP_URL and no key by default', async () => {
    const world = seededWorld();
    const { share, generatedKeys } = await world.createShareLink.execute(owner, form());

    expect(share.token).toHaveLength(SHARE_TOKEN_LENGTH);
    expect(share.url).toBe(`${APP_URL}/s/${share.token}`);
    expect(share).toMatchObject({
      title: 'Propuesta Kairos',
      message: null,
      client: null,
      locale: 'es',
      allowDownload: true,
      expiresAt: null,
      revokedAt: null,
      status: 'ACTIVE',
      lastAccessedAt: null,
      counters: { viewCount: 0, downloadCount: 0, unlockCount: 0, failedUnlockCount: 0 },
      createdBy: { id: owner.userId, name: 'owner' },
    });
    expect(share.documents).toHaveLength(1);
    expect(share.documents[0]).toMatchObject({
      document: { type: 'DOCUMENT', id: 'doc_a', code: 'DOC-doc_a', label: 'Documento doc_a' },
      versionId: null,
      isLatest: true,
      versionNumber: 3,
      format: 'MARKDOWN',
      order: 0,
      requiresAccessKey: false,
      accessKeyUpdatedAt: null,
    });
    expect(generatedKeys).toEqual([]);
  });

  it('strips trailing slashes from APP_URL when it builds the link', () => {
    expect(shareUrl('https://app.example.test/', 'tok')).toBe('https://app.example.test/s/tok');
    expect(shareUrl('https://app.example.test', 'tok')).toBe('https://app.example.test/s/tok');
  });

  it('keeps the EN locale, no download, the client and the expiry asked for', async () => {
    const world = seededWorld();
    const { share } = await world.createShareLink.execute(
      owner,
      form({
        message: '  Hola  ',
        clientId: 'cli_kairos',
        locale: 'en',
        allowDownload: false,
        expiresAt: '2026-12-31',
      }),
    );
    expect(share).toMatchObject({
      message: 'Hola',
      client: { type: 'CLIENT', id: 'cli_kairos', label: 'Kairos' },
      locale: 'en',
      allowDownload: false,
      expiresAt: '2026-12-31',
    });
  });

  it('pins a document to a version or follows the latest one', async () => {
    const world = seededWorld();
    const { share } = await world.createShareLink.execute(
      owner,
      form({
        documents: [
          { documentId: 'doc_a', versionId: 'doc_a_v1' },
          { documentId: 'doc_b', versionId: null },
        ],
      }),
    );
    expect(share.documents.map((doc) => [doc.versionId, doc.versionNumber, doc.isLatest])).toEqual([
      ['doc_a_v1', 1, false],
      [null, 1, true],
    ]);
    expect(share.documents.map((doc) => doc.order)).toEqual([0, 1]);
  });

  it('generates a key once per document that asks for it and stores only the hash', async () => {
    const world = seededWorld();
    const { share, generatedKeys } = await world.createShareLink.execute(
      owner,
      form({ documents: KEYED }),
    );

    expect(generatedKeys).toHaveLength(1);
    expect(generatedKeys[0]).toMatchObject({ documentId: 'doc_a' });
    const clear = must(generatedKeys[0]).accessKey;
    expect(share.documents.map((doc) => doc.requiresAccessKey)).toEqual([true, false]);
    expect(must(share.documents[0]).accessKeyUpdatedAt).toEqual(world.clock.now());

    const stored = world.shares.storedDocuments(share.id);
    expect(must(stored.find((row) => row.documentId === 'doc_a')).accessKeyHash).toBe(
      `hash:${clear}`,
    );
    expect(must(stored.find((row) => row.documentId === 'doc_b')).accessKeyHash).toBeNull();
    // The clear key is nowhere else: not in the read model, not in the activity entry.
    expect(JSON.stringify(share)).not.toContain(clear);
    expect(JSON.stringify(world.activity.entries)).not.toContain(clear);
    expect(JSON.stringify(world.activity.entries)).not.toContain('hash:');
    expect(JSON.stringify(await world.getShareLink.execute(owner, { id: share.id }))).not.toContain(
      clear,
    );
  });

  it('hashes every key before the unit of work opens (A1)', async () => {
    const world = seededWorld();
    await world.createShareLink.execute(
      owner,
      form({
        documents: [
          { documentId: 'doc_a', requiresAccessKey: true },
          { documentId: 'doc_b', requiresAccessKey: true },
        ],
      }),
    );
    expect(world.secrets.hashedInsideUow).toEqual([false, false]);
    expect(world.uow.lastOptions).toEqual({ isolation: 'Serializable' });
  });

  it('logs SHARE_CREATE with the counts and nothing secret', async () => {
    const world = seededWorld();
    const { share } = await world.createShareLink.execute(owner, form({ documents: KEYED }));
    expect(world.activity.entries).toHaveLength(1);
    expect(world.activity.entries[0]).toMatchObject({
      action: 'SHARE_CREATE',
      entityType: 'SHARE_LINK',
      entityId: share.id,
      entityLabel: 'Propuesta Kairos',
      actor: { actorType: 'USER', userId: owner.userId },
      metadata: { documentCount: 2, protectedDocumentCount: 1 },
    });
    expect(JSON.stringify(world.activity.entries)).not.toContain(share.token);
  });

  it('lets an admin create links', async () => {
    const world = seededWorld();
    await expect(world.createShareLink.execute(admin, form())).resolves.toHaveProperty(
      'share.status',
      'ACTIVE',
    );
  });

  it.each([
    ['member', member],
    ['viewer', viewer],
  ])('refuses the %s role with FORBIDDEN and writes nothing', async (_name, user) => {
    const world = seededWorld();
    await expect(world.createShareLink.execute(user, form())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(world.shares.rows).toHaveLength(0);
    expect(world.activity.entries).toHaveLength(0);
  });

  describe('reference checks and shape rules, without the DTO', () => {
    async function rejected(world: ReturnType<typeof seededWorld>, input: Record<string, unknown>) {
      const error = await world.createShareLink
        .execute(owner, input as ReturnType<typeof form>)
        .catch((e: unknown) => e as { code: string; fieldErrors?: Record<string, string[]> });
      expect(error).toMatchObject({ code: 'VALIDATION' });
      expect(world.shares.rows).toHaveLength(0);
      expect(world.activity.entries).toHaveLength(0);
      return (error as { fieldErrors: Record<string, string[]> }).fieldErrors;
    }

    it('rejects a version of another document', async () => {
      const world = seededWorld();
      const errors = await rejected(
        world,
        form({ documents: [{ documentId: 'doc_b', versionId: 'doc_a_v1' }] }),
      );
      expect(errors).toHaveProperty(['documents.0.versionId'], ['validation.invalidOption']);
    });

    it('rejects an unknown version, an unknown document, an archived one and one without a version', async () => {
      const world = seededWorld();
      world.seedDocument('doc_draft', { versions: 0 });
      world.seedDocument('doc_old', { archived: true });
      expect(
        await rejected(world, form({ documents: [{ documentId: 'doc_a', versionId: 'nope' }] })),
      ).toHaveProperty(['documents.0.versionId']);
      expect(
        await rejected(world, form({ documents: [{ documentId: 'doc_missing' }] })),
      ).toHaveProperty(['documents.0.documentId']);
      expect(
        await rejected(world, form({ documents: [{ documentId: 'doc_old' }] })),
      ).toHaveProperty(['documents.0.documentId']);
      expect(
        await rejected(world, form({ documents: [{ documentId: 'doc_draft' }] })),
      ).toHaveProperty(['documents.0.documentId']);
    });

    it('rejects a past expiry, but accepts today (the last valid day)', async () => {
      const world = seededWorld();
      expect(await rejected(world, form({ expiresAt: '2026-10-29' }))).toHaveProperty([
        'expiresAt',
      ]);
      await expect(
        world.createShareLink.execute(owner, form({ expiresAt: '2026-10-30' })),
      ).resolves.toHaveProperty('share.expiresAt', '2026-10-30');
    });

    it('rejects an unknown and an archived client', async () => {
      const world = seededWorld();
      world.addClient('cli_old', 'Viejo');
      world.noteTargets.archive('CLIENT', 'cli_old');
      expect(await rejected(world, form({ clientId: 'cli_missing' }))).toHaveProperty(['clientId']);
      expect(await rejected(world, form({ clientId: 'cli_old' }))).toHaveProperty(['clientId']);
    });

    it('rejects an empty or repeated document list and too many documents', async () => {
      const world = seededWorld();
      expect(await rejected(world, form({ documents: [] }))).toHaveProperty(['documents']);
      expect(
        await rejected(
          world,
          form({ documents: [{ documentId: 'doc_a' }, { documentId: 'doc_a' }] }),
        ),
      ).toHaveProperty(['documents']);
      expect(
        await rejected(
          world,
          form({
            documents: Array.from({ length: 51 }, (_, index) => ({ documentId: `d${index}` })),
          }),
        ),
      ).toHaveProperty(['documents'], ['validation.tooLong']);
      expect(await rejected(world, form({ documents: [{ documentId: '' }] }))).toHaveProperty([
        'documents.0.documentId',
      ]);
    });

    it('rejects a blank or long title, a long message, an unknown locale and a bad date', async () => {
      const world = seededWorld();
      expect(await rejected(world, form({ title: '   ' }))).toHaveProperty(
        ['title'],
        ['validation.required'],
      );
      expect(await rejected(world, form({ title: 'x'.repeat(201) }))).toHaveProperty(
        ['title'],
        ['validation.tooLong'],
      );
      expect(await rejected(world, form({ message: 'x'.repeat(2001) }))).toHaveProperty([
        'message',
      ]);
      expect(await rejected(world, form({ locale: 'fr' }))).toHaveProperty(['locale']);
      expect(await rejected(world, form({ expiresAt: '2026-13-40' }))).toHaveProperty([
        'expiresAt',
      ]);
    });
  });
});
