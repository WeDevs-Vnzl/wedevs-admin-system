import { describe, expect, it } from 'vitest';
import {
  KAIROS,
  KAIROS_WEB,
  SOLARIS,
  member,
  newDocument,
  owner,
  seededWorld,
} from '../../../../test/documents/records/world';
import { NotFoundError } from '../../../shared/domain/domain-error';
import { actorOf } from '../../../shared/application/actor';
import { documentSearchEntry, assertDistinctTargets } from './document-support';

// The seam the versions package builds on: `appendVersion`, `reindex`, `prepareVersion` and the activity scope.

describe('DocumentSupport.appendVersion', () => {
  it('appends version N+1, makes it current, reindexes the markdown and logs VERSION_PUBLISH', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument({ typeId: 'dtyp_nota' }));
    const record = await world.support.requireLive(doc.id);

    const first = await world.uow.run(async () => {
      await world.support.lock([doc.id]);
      return world.support.appendVersion(
        owner,
        record,
        { format: 'MARKDOWN', content: '# Hola', fileId: null, url: null },
        'Primera',
      );
    });
    const second = await world.uow.run(async () => {
      await world.support.lock([doc.id]);
      return world.support.appendVersion(
        owner,
        record,
        { format: 'MARKDOWN', content: '# Hola 2', fileId: null, url: null },
        null,
        1,
      );
    });

    expect([first.versionNumber, second.versionNumber]).toEqual([1, 2]);
    expect(world.documents.rows[0]?.currentVersionId).toBe(second.id);
    expect(world.search.get('DOCUMENT', doc.id)?.body).toBe('# Hola 2');
    const entries = world.activity.entries.filter((e) => e.action === 'VERSION_PUBLISH');
    expect(entries.map((e) => e.metadata)).toEqual([
      { versionNumber: 1, format: 'MARKDOWN' },
      { versionNumber: 2, format: 'MARKDOWN', restoredFrom: 1 },
    ]);
  });

  it('logs UPLOAD for a new file and VERSION_PUBLISH for a restored one', async () => {
    const world = seededWorld();
    world.seedFile('fil_a', owner);
    const doc = await world.createDocument.execute(owner, newDocument());
    const record = await world.support.requireLive(doc.id);
    const content = { format: 'ARCHIVO' as const, content: null, fileId: 'fil_a', url: null };

    await world.uow.run(async () => {
      await world.support.lock([doc.id]);
      await world.support.appendVersion(owner, record, content, null);
      await world.support.appendVersion(owner, record, content, null, 1);
    });

    expect(world.activity.entries.slice(-2).map((e) => e.action)).toEqual([
      'UPLOAD',
      'VERSION_PUBLISH',
    ]);
  });
});

describe('DocumentSupport.reindex and the search entry', () => {
  it('indexes code, title, type name, status, archived flag and summary plus markdown', () => {
    const entry = documentSearchEntry(
      { id: 'd', code: 'DOC-0001', title: 'T', summary: 'S', status: 'APROBADO' },
      'NDA',
      '# md',
      true,
    );
    expect(entry).toEqual({
      entityType: 'DOCUMENT',
      entityId: 'd',
      code: 'DOC-0001',
      title: 'T',
      subtitle: 'NDA',
      body: 'S\n\n# md',
      status: 'APROBADO',
      archived: true,
    });
    expect(
      documentSearchEntry(
        { id: 'd', code: 'c', title: 't', summary: null, status: 'BORRADOR' },
        'x',
        null,
        false,
      ).body,
    ).toBeNull();
  });
});

describe('DocumentSupport helpers', () => {
  it('requireLive answers NOT_FOUND for unknown and archived documents', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(owner, newDocument());
    await expect(world.support.requireLive(doc.id)).resolves.toMatchObject({ id: doc.id });
    await expect(world.support.requireLive('doc_missing')).rejects.toBeInstanceOf(NotFoundError);
    world.seedDocument({ id: 'doc_gone', typeId: 'dtyp_nda', deletedAt: new Date() });
    await expect(world.support.requireLive('doc_gone')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('derives the client scope from CLIENT links and the clients of PROJECT links, in link order, once each', async () => {
    const world = seededWorld();
    expect(await world.support.clientScope([KAIROS_WEB, SOLARIS, KAIROS])).toEqual({
      clientId: 'cli_kairos',
      touchClientIds: ['cli_kairos', 'cli_solaris'],
    });
    expect(
      await world.support.clientScope([{ entityType: 'CONTACT', entityId: 'con_ana' }]),
    ).toEqual({ clientId: null, touchClientIds: [] });
    expect(
      await world.support.clientScope([{ entityType: 'PROJECT', entityId: 'pry_missing' }]),
    ).toEqual({ clientId: null, touchClientIds: [] });
  });

  it('assertDistinctTargets names the field', () => {
    expect(() => assertDistinctTargets([KAIROS, KAIROS], 'links')).toThrowError();
    expect(() => assertDistinctTargets([KAIROS, SOLARIS])).not.toThrow();
  });

  it('records an activity entry on behalf of any actor', async () => {
    const world = seededWorld();
    const doc = await world.createDocument.execute(member, newDocument());
    await world.uow.run(() =>
      world.support.record(actorOf(owner), { id: doc.id, title: doc.title }, 'UPDATE', {
        metadata: { draft: true },
      }),
    );
    expect(world.activity.entries.at(-1)).toMatchObject({
      action: 'UPDATE',
      metadata: { draft: true },
      clientId: 'cli_kairos',
    });
  });
});
