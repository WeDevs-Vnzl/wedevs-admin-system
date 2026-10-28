import { describe, expect, it } from 'vitest';
import { EXE_HEAD, PDF_HEAD, PNG_HEAD } from '../../../../../test/files/fake-content-sniffer';
import { buildFilesHarness, member, other, viewer } from '../../../../../test/files/harness';

const MB = 1024 * 1024;

async function pending(
  h: ReturnType<typeof buildFilesHarness>,
  input: { name: string; mime: string; context?: 'general' | 'payment_receipt' } = {
    name: 'a.pdf',
    mime: 'application/pdf',
  },
) {
  const out = await h.requestUpload.execute(member, {
    ...input,
    size: 100,
    context: input.context ?? 'general',
  });
  return { fileId: out.fileId, key: `${input.context ?? 'general'}/2026/10/${out.fileId}` };
}

describe('ConfirmUpload', () => {
  it('verifies the bytes, marks READY with the real size and records one UPLOAD activity', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, PDF_HEAD);

    const file = await h.confirmUpload.execute(member, { fileId });

    expect(file).toMatchObject({ status: 'READY', sizeBytes: PDF_HEAD.byteLength });
    expect((await h.files.findById(fileId))?.status).toBe('READY');
    expect(h.activity.entries).toHaveLength(1);
    expect(h.activity.entries[0]).toMatchObject({
      action: 'UPLOAD',
      entityType: 'FILE',
      entityId: fileId,
      entityLabel: 'a.pdf',
      actor: { actorType: 'USER', userId: member.userId },
    });
  });

  it('is idempotent on a READY file: no second activity, no storage call', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, PDF_HEAD);
    await h.confirmUpload.execute(member, { fileId });
    const again = await h.confirmUpload.execute(member, { fileId });
    expect(again.status).toBe('READY');
    expect(h.activity.entries).toHaveLength(1);
  });

  it('answers NOT_FOUND for another user, an unknown id and a deleted file (C14)', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, PDF_HEAD);
    await expect(h.confirmUpload.execute(other, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(h.confirmUpload.execute(member, { fileId: 'nope' })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await h.files.softDelete(fileId, new Date());
    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('gives a Viewer FORBIDDEN', async () => {
    const h = buildFilesHarness();
    await expect(h.confirmUpload.execute(viewer, { fileId: 'x' })).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('keeps the row PENDING when nothing was uploaded yet', async () => {
    const h = buildFilesHarness();
    const { fileId } = await pending(h);
    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { file: ['validation.file.notUploaded'] },
    });
    expect((await h.files.findById(fileId))?.status).toBe('PENDING');
  });

  it('spoofed type (executable declared PDF): destroys the asset, soft-deletes the row, VALIDATION', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, EXE_HEAD);

    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { mime: ['validation.file.typeNotAllowed'] },
    });
    expect(h.storage.destroyed).toEqual([key]);
    expect(await h.files.findById(fileId)).toBeNull();
    expect(h.files.rows.get(fileId)?.deletedAt).not.toBeNull();
    expect(h.activity.entries).toHaveLength(0);
  });

  it('rejects a real type that differs from the declared one', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, PNG_HEAD);
    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(h.storage.has(key)).toBe(false);
  });

  it('rejects an object over the context limit (payment receipt 10 MB)', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h, {
      name: 'r.pdf',
      mime: 'application/pdf',
      context: 'payment_receipt',
    });
    h.storage.put(key, new Uint8Array(10 * MB + 1));
    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { size: ['validation.file.tooLarge'] },
    });
    expect(h.storage.destroyed).toEqual([key]);
  });

  it('rejects an empty object', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, new Uint8Array(0));
    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      fieldErrors: { size: ['validation.file.empty'] },
    });
  });

  it('accepts a markdown file declared as text with a valid UTF-8 head, and rejects binary junk', async () => {
    const h = buildFilesHarness();
    const ok = await pending(h, { name: 'n.md', mime: 'text/markdown' });
    h.storage.put(ok.key, new TextEncoder().encode('# Notas\n\ntexto'));
    expect(await h.confirmUpload.execute(member, { fileId: ok.fileId })).toMatchObject({
      status: 'READY',
      mimeType: 'text/markdown',
    });

    const bad = await pending(h, { name: 'x.md', mime: 'text/markdown' });
    h.storage.put(bad.key, new Uint8Array([0x61, 0x00, 0x62]));
    await expect(h.confirmUpload.execute(member, { fileId: bad.fileId })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });

  it('still fails with VALIDATION when destroying the asset fails, and reports the cleanup failure', async () => {
    const h = buildFilesHarness();
    const { fileId, key } = await pending(h);
    h.storage.put(key, EXE_HEAD);
    h.storage.failDestroy = true;
    await expect(h.confirmUpload.execute(member, { fileId })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(h.cleanupFailures).toHaveLength(1);
    expect(await h.files.findById(fileId)).toBeNull();
  });
});
