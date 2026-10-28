import { describe, expect, it } from 'vitest';
import { PDF_HEAD } from '../../../../../test/files/fake-content-sniffer';
import { FakeAuthorization } from '../../../../../test/support/fakes/fake-authorization';
import { buildFilesHarness, member, other } from '../../../../../test/files/harness';

async function upload(h: ReturnType<typeof buildFilesHarness>, confirm = true) {
  const { fileId } = await h.requestUpload.execute(member, {
    name: 'a.pdf',
    mime: 'application/pdf',
    size: 100,
    context: 'general',
  });
  if (confirm) {
    h.storage.put(`general/2026/10/${fileId}`, PDF_HEAD);
    await h.confirmUpload.execute(member, { fileId });
  }
  return fileId;
}

describe('ReserveFileForAttachment', () => {
  it('locks the row and returns the file summary for the uploader', async () => {
    const h = buildFilesHarness();
    const fileId = await upload(h);
    const out = await h.uow.run(() => h.reserveFile.execute(member, fileId));
    expect(out).toEqual({
      id: fileId,
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: h.files.rows.get(fileId)?.sizeBytes,
    });
    expect(h.files.locked).toEqual([fileId]);
  });

  it('answers NOT_FOUND for another user’s unattached file (C14)', async () => {
    const h = buildFilesHarness();
    const fileId = await upload(h);
    await expect(h.reserveFile.execute(other, fileId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('answers NOT_FOUND for a PENDING, deleted or unknown file', async () => {
    const h = buildFilesHarness();
    const pending = await upload(h, false);
    await expect(h.reserveFile.execute(member, pending)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const gone = await upload(h);
    await h.deleteFile.execute(member, { fileId: gone });
    await expect(h.reserveFile.execute(member, gone)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.reserveFile.execute(member, 'nope')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('lets a non-uploader reuse a file claimed by a resource they can read, else NOT_FOUND', async () => {
    const h = buildFilesHarness();
    const fileId = await upload(h);
    h.registry.register({
      resolve: () => Promise.resolve({ kind: 'resource', resource: 'invoice', ownerId: null }),
    });
    const out = await h.reserveFile.execute(other, fileId);
    expect(out.id).toBe(fileId);

    const denying = buildFilesHarness(
      new FakeAuthorization({ policy: (_user, action) => action !== 'read' }),
    );
    const id2 = await upload(denying);
    denying.registry.register({
      resolve: () => Promise.resolve({ kind: 'resource', resource: 'invoice', ownerId: null }),
    });
    await expect(denying.reserveFile.execute(other, id2)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });
});
