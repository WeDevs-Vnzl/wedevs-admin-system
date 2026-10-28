import { describe, expect, it } from 'vitest';
import { buildFilesHarness, member, other } from '../../../../test/files/harness';
import { PlatformCompanyLogoAdapter } from './platform-company-logo.adapter';

type Harness = ReturnType<typeof buildFilesHarness>;

async function uploadedFile(h: Harness, mime = 'image/png', name = 'logo.png') {
  const { fileId } = await h.requestUpload.execute(member, {
    name,
    mime,
    size: 10,
    context: 'general',
  });
  return fileId;
}

async function readyFile(h: Harness, mime = 'image/png', name = 'logo.png') {
  const id = await uploadedFile(h, mime, name);
  await h.files.markReady(id, { sizeBytes: 10, mimeType: mime });
  return id;
}

describe('PlatformCompanyLogoAdapter', () => {
  it('is false for an unknown or deleted file', async () => {
    const h = buildFilesHarness();
    const adapter = new PlatformCompanyLogoAdapter(h.getSummary);
    expect(await adapter.canBeLogo(member, 'missing')).toBe(false);
    const id = await uploadedFile(h);
    await h.files.softDelete(id, new Date());
    expect(await adapter.canBeLogo(member, id)).toBe(false);
  });

  it('is false while the file is still PENDING', async () => {
    const h = buildFilesHarness();
    const adapter = new PlatformCompanyLogoAdapter(h.getSummary);
    expect(await adapter.canBeLogo(member, await uploadedFile(h))).toBe(false);
  });

  it('is true for the caller’s own READY, unattached image', async () => {
    const h = buildFilesHarness();
    const adapter = new PlatformCompanyLogoAdapter(h.getSummary);
    expect(await adapter.canBeLogo(member, await readyFile(h))).toBe(true);
  });

  it('is false for a READY file that is not an image', async () => {
    const h = buildFilesHarness();
    const adapter = new PlatformCompanyLogoAdapter(h.getSummary);
    const id = await readyFile(h, 'application/pdf', 'a.pdf');
    expect(await adapter.canBeLogo(member, id)).toBe(false);
  });

  it('is false for an image another user uploaded', async () => {
    const h = buildFilesHarness();
    const adapter = new PlatformCompanyLogoAdapter(h.getSummary);
    const id = await readyFile(h);
    expect(await adapter.canBeLogo(other, id)).toBe(false);
  });

  it('is false for an image attached elsewhere (resolver claim or database reference)', async () => {
    const h = buildFilesHarness();
    const adapter = new PlatformCompanyLogoAdapter(h.getSummary);
    const referenced = await readyFile(h);
    h.files.referenced.add(referenced);
    expect(await adapter.canBeLogo(member, referenced)).toBe(false);

    const claimed = await readyFile(h);
    h.registry.register({
      resolve: (id) => Promise.resolve(id === claimed ? { kind: 'authenticated' } : null),
    });
    expect(await adapter.canBeLogo(member, claimed)).toBe(false);
  });
});
