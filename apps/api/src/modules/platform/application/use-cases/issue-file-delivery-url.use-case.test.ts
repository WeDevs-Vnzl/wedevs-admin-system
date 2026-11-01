import { describe, expect, it } from 'vitest';
import { PDF_HEAD } from '../../../../../test/files/fake-content-sniffer';
import { buildFilesHarness, member } from '../../../../../test/files/harness';
import { IssueFileDeliveryUrl } from './issue-file-delivery-url.use-case';

async function setup(confirm = true) {
  const h = buildFilesHarness();
  const { fileId } = await h.requestUpload.execute(member, {
    name: 'Contrato.pdf',
    mime: 'application/pdf',
    size: 100,
    context: 'general',
  });
  if (confirm) {
    h.storage.put(`general/2026/10/${fileId}`, PDF_HEAD);
    await h.confirmUpload.execute(member, { fileId });
  }
  return { h, fileId, issue: new IssueFileDeliveryUrl(h.files, h.storage, h.clock) };
}

describe('IssueFileDeliveryUrl', () => {
  it('signs an attachment URL for the requested lifetime by default', async () => {
    const { fileId, issue } = await setup();
    const out = await issue.execute(fileId, { ttlMs: 300_000 });
    expect(out.expiresAt.toISOString()).toBe('2026-10-25T10:05:00.000Z');
    expect(out).toMatchObject({ fileName: 'Contrato.pdf', mimeType: 'application/pdf' });
    const query = new URL(out.url).searchParams;
    expect(query.get('name')).toBe('Contrato.pdf');
    expect(query.get('exp')).toBe(String(out.expiresAt.getTime()));
    expect(query.has('disposition')).toBe(false);
  });

  it('passes inline through to the storage', async () => {
    const { fileId, issue } = await setup();
    const out = await issue.execute(fileId, { disposition: 'inline', ttlMs: 300_000 });
    expect(new URL(out.url).searchParams.get('disposition')).toBe('inline');
  });

  it('answers NOT_FOUND for a PENDING, deleted or unknown file', async () => {
    const pending = await setup(false);
    await expect(pending.issue.execute(pending.fileId, { ttlMs: 1000 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    const gone = await setup();
    await gone.h.deleteFile.execute(member, { fileId: gone.fileId });
    await expect(gone.issue.execute(gone.fileId, { ttlMs: 1000 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
    await expect(gone.issue.execute('nope', { ttlMs: 1000 })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('rejects a non-positive lifetime', async () => {
    const { fileId, issue } = await setup();
    await expect(issue.execute(fileId, { ttlMs: 0 })).rejects.toThrow(RangeError);
  });
});
