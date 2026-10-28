import { describe, expect, it } from 'vitest';
import { buildFilesHarness, member, viewer } from '../../../../../test/files/harness';

describe('GetFileSummary', () => {
  it('returns id, status, type, uploader and the attached flag only, and null for unknown or deleted files', async () => {
    const h = buildFilesHarness();
    const { fileId } = await h.requestUpload.execute(member, {
      name: 'logo.png',
      mime: 'image/png',
      size: 1,
      context: 'general',
    });
    expect(await h.getSummary.execute(member, fileId)).toEqual({
      id: fileId,
      status: 'PENDING',
      mimeType: 'image/png',
      uploadedById: member.userId,
      attached: false,
    });
    h.files.referenced.add(fileId);
    expect(await h.getSummary.execute(member, fileId)).toMatchObject({ attached: true });
    h.files.referenced.clear();
    h.registry.register({ resolve: () => Promise.resolve({ kind: 'authenticated' }) });
    expect(await h.getSummary.execute(member, fileId)).toMatchObject({ attached: true });
    expect(await h.getSummary.execute(member, 'nope')).toBeNull();
    await h.files.softDelete(fileId, new Date());
    expect(await h.getSummary.execute(member, fileId)).toBeNull();
  });

  it('refuses a caller who cannot attach files', async () => {
    const h = buildFilesHarness();
    await expect(h.getSummary.execute(viewer, 'x')).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
