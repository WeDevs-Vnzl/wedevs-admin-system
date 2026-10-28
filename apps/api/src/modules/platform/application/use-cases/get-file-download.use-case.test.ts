import { describe, expect, it } from 'vitest';
import { PDF_HEAD } from '../../../../../test/files/fake-content-sniffer';
import { buildFilesHarness, member, other } from '../../../../../test/files/harness';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';

async function readyFile(h: ReturnType<typeof buildFilesHarness>) {
  const { fileId } = await h.requestUpload.execute(member, {
    name: 'Contrato final.pdf',
    mime: 'application/pdf',
    size: 100,
    context: 'general',
  });
  h.storage.put(`general/2026/10/${fileId}`, PDF_HEAD);
  await h.confirmUpload.execute(member, { fileId });
  return fileId;
}

describe('GetFileDownload', () => {
  it('lets the uploader download an unattached file through a 60 s signed attachment URL', async () => {
    const h = buildFilesHarness();
    const fileId = await readyFile(h);
    const out = await h.getDownload.execute(member, { fileId });
    expect(out.expiresAt.toISOString()).toBe('2026-10-25T10:01:00.000Z');
    expect(out.url).toContain(`general/2026/10/${fileId}`);
    expect(new URL(out.url).searchParams.get('name')).toBe('Contrato final.pdf');
  });

  it('answers NOT_FOUND to anyone else for an unattached file', async () => {
    const h = buildFilesHarness();
    const fileId = await readyFile(h);
    await expect(h.getDownload.execute(other, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers NOT_FOUND for PENDING, deleted and unknown files', async () => {
    const h = buildFilesHarness();
    const { fileId } = await h.requestUpload.execute(member, {
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 1,
      context: 'general',
    });
    await expect(h.getDownload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.getDownload.execute(member, { fileId: 'zzz' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const ready = await readyFile(h);
    await h.files.softDelete(ready, new Date());
    await expect(h.getDownload.execute(member, { fileId: ready })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('fails closed on a file some table references but no resolver claims', async () => {
    const h = buildFilesHarness();
    const fileId = await readyFile(h);
    h.files.referenced.add(fileId);
    await expect(h.getDownload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('an authenticated claim (company logo) is open to any signed-in user', async () => {
    const h = buildFilesHarness();
    const fileId = await readyFile(h);
    h.registry.register({
      resolve: (id) => Promise.resolve(id === fileId ? { kind: 'authenticated' } : null),
    });
    await expect(h.getDownload.execute(other, { fileId })).resolves.toMatchObject({
      url: expect.stringContaining('storage.test') as string,
    });
  });

  it('a resource claim needs read on that resource, passing the owner id', async () => {
    const seen: unknown[] = [];
    const authorization = new FakeAuthorization({
      policy: (user, action, resource, opts) => {
        seen.push([action, resource, opts]);
        return action === 'create' || user.userId === member.userId;
      },
    });
    const h = buildFilesHarness(authorization);
    const fileId = await readyFile(h);
    h.registry.register({
      resolve: () => Promise.resolve({ kind: 'resource', resource: 'invoice', ownerId: 'usr_x' }),
    });
    await expect(h.getDownload.execute(member, { fileId })).resolves.toBeDefined();
    await expect(h.getDownload.execute(other, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(seen).toContainEqual(['read', 'invoice', { ownerId: 'usr_x' }]);
  });
});
