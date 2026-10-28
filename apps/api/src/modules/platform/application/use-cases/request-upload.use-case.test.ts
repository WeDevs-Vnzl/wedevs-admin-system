import { describe, expect, it } from 'vitest';
import { buildFilesHarness, member, viewer } from '../../../../../test/files/harness';
import { DomainError } from '../../../../shared/domain/domain-error';

const valid = {
  name: 'contract.pdf',
  mime: 'application/pdf',
  size: 1024,
  context: 'general',
} as const;

describe('RequestUpload', () => {
  it('registers a PENDING file owned by the caller and returns a 5-minute signed intent', async () => {
    const h = buildFilesHarness();
    const out = await h.requestUpload.execute(member, valid);

    expect(out.fileId).toBe('fil_1');
    expect(out.expiresAt.toISOString()).toBe('2026-10-25T10:05:00.000Z');
    expect(out.url).toBe('https://storage.test/upload');
    const row = await h.files.findById('fil_1');
    expect(row).toMatchObject({
      status: 'PENDING',
      uploadedById: member.userId,
      storageKey: 'general/2026/10/fil_1',
      originalName: 'contract.pdf',
      mimeType: 'application/pdf',
      bucket: 'memory',
    });
    expect(h.storage.intents[0]).toMatchObject({ storageKey: 'general/2026/10/fil_1' });
  });

  it('derives the declared type from the extension when the client sends none', async () => {
    const h = buildFilesHarness();
    await h.requestUpload.execute(member, { ...valid, name: 'notes.md', mime: '' });
    expect((await h.files.findById('fil_1'))?.mimeType).toBe('text/markdown');
  });

  it('gives a Viewer FORBIDDEN and writes nothing', async () => {
    const h = buildFilesHarness();
    await expect(h.requestUpload.execute(viewer, valid)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    expect(h.files.rows.size).toBe(0);
  });

  it.each([
    [
      { ...valid, size: 11 * 1024 * 1024, context: 'payment_receipt' as const },
      'size',
      'validation.file.tooLarge',
    ],
    [
      { ...valid, mime: 'application/x-msdownload', name: 'a.exe' },
      'mime',
      'validation.file.typeNotAllowed',
    ],
    [{ ...valid, size: 0 }, 'size', 'validation.file.empty'],
    [{ ...valid, name: '../x.pdf' }, 'name', 'validation.file.nameInvalid'],
  ])('rejects %j with a field error and persists nothing', async (input, field, key) => {
    const h = buildFilesHarness();
    const error = await h.requestUpload.execute(member, input).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect(error).toMatchObject({ code: 'VALIDATION', fieldErrors: { [field]: [key] } });
    expect(h.files.rows.size).toBe(0);
    expect(h.storage.intents).toHaveLength(0);
  });
});
