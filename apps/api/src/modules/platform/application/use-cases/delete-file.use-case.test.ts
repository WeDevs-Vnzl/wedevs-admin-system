import { describe, expect, it } from 'vitest';
import { PDF_HEAD } from '../../../../../test/files/fake-content-sniffer';
import { buildFilesHarness, member, other, viewer } from '../../../../../test/files/harness';

async function readyFile(h: ReturnType<typeof buildFilesHarness>) {
  const { fileId } = await h.requestUpload.execute(member, {
    name: 'a.pdf',
    mime: 'application/pdf',
    size: 100,
    context: 'general',
  });
  const key = `general/2026/10/${fileId}`;
  h.storage.put(key, PDF_HEAD);
  await h.confirmUpload.execute(member, { fileId });
  return { fileId, key };
}

describe('DeleteFile', () => {
  it('soft-deletes the uploader’s unattached file, records DELETE and destroys the asset', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await readyFile(h);
    await h.deleteFile.execute(member, { fileId });
    expect(await h.files.findById(fileId)).toBeNull();
    expect(h.files.rows.get(fileId)?.deletedAt).toEqual(h.clock.now());
    expect(h.storage.destroyed).toEqual([key]);
    expect(h.activity.entries.map((e) => e.action)).toEqual(['UPLOAD', 'DELETE']);
  });

  it('answers NOT_FOUND for another user’s file and for unknown ids, changing nothing', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await readyFile(h);
    await expect(h.deleteFile.execute(other, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.deleteFile.execute(member, { fileId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    expect(h.storage.has(key)).toBe(true);
    expect(await h.files.findById(fileId)).not.toBeNull();
  });

  it('refuses an attached file with INTEGRITY_LOCK (resolver claim or database reference)', async () => {
    const h = buildFilesHarness();
    const { fileId } = await readyFile(h);
    h.files.referenced.add(fileId);
    await expect(h.deleteFile.execute(member, { fileId })).rejects.toMatchObject({
      code: 'INTEGRITY_LOCK',
    });
    h.files.referenced.clear();
    h.registry.register({ resolve: () => Promise.resolve({ kind: 'authenticated' }) });
    await expect(h.deleteFile.execute(member, { fileId })).rejects.toMatchObject({
      code: 'INTEGRITY_LOCK',
    });
    expect(await h.files.findById(fileId)).not.toBeNull();
  });

  it('takes the file row lock before its checks', async () => {
    const h = buildFilesHarness();
    const { fileId } = await readyFile(h);
    await h.deleteFile.execute(member, { fileId });
    expect(h.files.locked).toEqual([fileId]);
  });

  it('keeps the deletion when destroying the asset fails and reports the failure', async () => {
    const h = buildFilesHarness();
    const { fileId } = await readyFile(h);
    h.storage.failDestroy = true;
    await expect(h.deleteFile.execute(member, { fileId })).resolves.toBeUndefined();
    expect(await h.files.findById(fileId)).toBeNull();
    expect(h.cleanupFailures).toHaveLength(1);
  });

  it('deletes a PENDING file too', async () => {
    const h = buildFilesHarness();
    const { fileId } = await h.requestUpload.execute(member, {
      name: 'a.pdf',
      mime: 'application/pdf',
      size: 1,
      context: 'general',
    });
    await h.deleteFile.execute(member, { fileId });
    expect(await h.files.findById(fileId)).toBeNull();
  });

  it('refuses a caller who cannot upload files with FORBIDDEN, before looking at the file', async () => {
    const h = buildFilesHarness();
    const { fileId } = await readyFile(h);
    await expect(h.deleteFile.execute(viewer, { fileId })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(h.deleteFile.execute(viewer, { fileId: 'nope' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(await h.files.findById(fileId)).not.toBeNull();
  });
});
