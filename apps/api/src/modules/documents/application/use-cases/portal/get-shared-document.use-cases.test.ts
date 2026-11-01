import { describe, expect, it } from 'vitest';
import {
  createPortalWorld,
  KEY,
  OTHER_TOKEN,
  TOKEN,
  visitor,
  type PortalWorld,
} from '../../../../../../test/documents/portal/world';

// Ported from `portal-shares.test.ts` (`getSharedDocument`, `getSharedDocumentDownload`) and
// `features/portal/queries.ts` (the file route), with contract choices 8 and 9.

const DOCS = [
  {
    id: 'doc_contrato',
    code: 'DOC-0001',
    format: 'ARCHIVO' as const,
    file: { id: 'fil_c', name: 'contrato.pdf', mime: 'application/pdf', size: 2048 },
  },
  { id: 'doc_prd', code: 'DOC-0002', content: '# PRD\n\n<script>alert(1)</script>' },
  { id: 'doc_cred', format: 'ENLACE' as const, url: 'https://creds.test/x', key: KEY },
  {
    id: 'doc_img',
    format: 'ARCHIVO' as const,
    file: { id: 'fil_i', name: 'logo.png', mime: 'image/png', size: 10 },
  },
  {
    id: 'doc_zip',
    format: 'ARCHIVO' as const,
    file: { id: 'fil_z', name: 'a.zip', mime: 'application/zip', size: 10 },
  },
  {
    id: 'doc_bad',
    format: 'ENLACE' as const,
    url: 'javascript:alert(1)',
  },
  {
    id: 'doc_pending',
    format: 'ARCHIVO' as const,
    file: { id: 'fil_p', name: 'p.pdf', mime: 'application/pdf', size: 1, status: 'PENDING' },
  },
];

async function seeded(over = {}): Promise<PortalWorld> {
  const w = createPortalWorld();
  await w.seedLink(DOCS, over);
  return w;
}

const get = (w: PortalWorld, documentId: string, unlockCookie?: string) =>
  w.getDocument.execute({ token: TOKEN, documentId, visitor: visitor({ unlockCookie }) });

const deliver = (
  w: PortalWorld,
  documentId: string,
  disposition: 'inline' | 'attachment',
  unlockCookie?: string,
) =>
  w.getDelivery.execute({
    token: TOKEN,
    documentId,
    disposition,
    visitor: visitor({ unlockCookie }),
  });

describe('GetSharedDocument', () => {
  it('returns the raw markdown of a markdown document (the FE sanitizes it, C4)', async () => {
    const w = await seeded();
    const view = await get(w, 'doc_prd');
    expect(view.content).toEqual({
      format: 'MARKDOWN',
      markdown: '# PRD\n\n<script>alert(1)</script>',
    });
    expect(view.document).toMatchObject({ documentId: 'doc_prd', locked: false });
  });

  it('describes a PDF, an image and another file for the viewer, without any file key', async () => {
    const w = await seeded();
    expect((await get(w, 'doc_contrato')).content).toEqual({
      format: 'ARCHIVO',
      fileName: 'contrato.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
      preview: 'pdf',
    });
    expect((await get(w, 'doc_img')).content).toMatchObject({ preview: 'image' });
    expect((await get(w, 'doc_zip')).content).toMatchObject({ preview: 'none' });
    expect(JSON.stringify(await get(w, 'doc_contrato'))).not.toMatch(/fil_c|storageKey|usr_/);
  });

  it('returns the stored URL of a link document, http(s) only', async () => {
    const w = await seeded();
    expect((await get(w, 'doc_cred', w.cookieFor(['doc_cred']))).content).toEqual({
      format: 'ENLACE',
      url: 'https://creds.test/x',
    });
    await expect(get(w, 'doc_bad')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a locked document with FORBIDDEN until the signed cookie unlocks it', async () => {
    const w = await seeded();
    await expect(get(w, 'doc_cred')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await get(w, 'doc_cred', w.cookieFor(['doc_cred']))).content.format).toBe('ENLACE');
  });

  it('refuses a forged cookie, a cookie of another link and a cookie for another document', async () => {
    const w = await seeded();
    const forged = `${w.cookieFor(['doc_cred']).split('.')[0]}.AAAA`;
    for (const cookie of [
      forged,
      w.cookieFor(['doc_cred'], OTHER_TOKEN),
      w.cookieFor(['doc_prd']),
    ]) {
      await expect(get(w, 'doc_cred', cookie)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    }
  });

  it('answers NOT_FOUND for a document outside the link, an archived one, a pending file and a dead token', async () => {
    const w = await seeded();
    await expect(get(w, 'doc_other')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(get(w, 'doc_pending')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    w.archive('shr_a', 'doc_prd');
    await expect(get(w, 'doc_prd')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      w.getDocument.execute({ token: 'Z'.repeat(43), documentId: 'doc_prd', visitor: visitor() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('writes no access-log row', async () => {
    const w = await seeded();
    await get(w, 'doc_prd');
    expect(w.accessLog.rows).toEqual([]);
  });
});

describe('GetSharedDocumentDelivery', () => {
  it('serves markdown as an attachment named <code>-v<n>.md and logs DOWNLOAD', async () => {
    const w = await seeded();
    const result = await deliver(w, 'doc_prd', 'attachment');
    expect(result).toEqual({
      kind: 'markdown',
      body: '# PRD\n\n<script>alert(1)</script>',
      fileName: 'DOC-0002-v1.md',
      attachment: true,
    });
    expect(w.accessLog.rows).toHaveLength(1);
    expect(w.accessLog.rows[0]).toMatchObject({ event: 'DOWNLOAD', documentId: 'doc_prd' });
    expect(w.accessLog.countersOf('shr_a')).toMatchObject({
      downloadCount: 1,
      viewCount: 0,
      lastAccessedAt: w.clock.now(),
    });
  });

  it('serves markdown inline, logging nothing', async () => {
    const w = await seeded();
    expect(await deliver(w, 'doc_prd', 'inline')).toMatchObject({
      kind: 'markdown',
      attachment: false,
    });
    expect(w.accessLog.rows).toEqual([]);
  });

  it('gives a file a signed URL of 5 minutes through IssueFileDeliveryUrl, with the disposition asked', async () => {
    const w = await seeded();
    const result = await deliver(w, 'doc_contrato', 'attachment');
    expect(result).toEqual({ kind: 'redirect', url: 'https://files.test/fil_c?d=attachment' });
    expect(w.files.calls).toEqual([{ fileId: 'fil_c', disposition: 'attachment', ttlMs: 300_000 }]);
    expect(w.accessLog.eventsOf('DOWNLOAD')).toHaveLength(1);

    await deliver(w, 'doc_contrato', 'inline');
    expect(w.files.calls[1]).toEqual({ fileId: 'fil_c', disposition: 'inline', ttlMs: 300_000 });
    // Inline logs nothing more.
    expect(w.accessLog.eventsOf('DOWNLOAD')).toHaveLength(1);
  });

  it('redirects a link document to its stored URL', async () => {
    const w = await seeded();
    const cookie = w.cookieFor(['doc_cred']);
    expect(await deliver(w, 'doc_cred', 'attachment', cookie)).toEqual({
      kind: 'redirect',
      url: 'https://creds.test/x',
    });
    expect(w.accessLog.eventsOf('DOWNLOAD')).toHaveLength(1);
    await expect(deliver(w, 'doc_bad', 'inline')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses a locked document with FORBIDDEN, inline or attachment, logging nothing', async () => {
    const w = await seeded();
    for (const disposition of ['inline', 'attachment'] as const) {
      await expect(deliver(w, 'doc_cred', disposition)).rejects.toMatchObject({
        code: 'FORBIDDEN',
      });
    }
    expect(w.accessLog.rows).toEqual([]);
  });

  it('with allowDownload=false refuses attachment with FORBIDDEN and still allows inline', async () => {
    const w = await seeded({ allowDownload: false });
    await expect(deliver(w, 'doc_prd', 'attachment')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(w.accessLog.rows).toEqual([]);
    expect(await deliver(w, 'doc_prd', 'inline')).toMatchObject({ kind: 'markdown' });
    expect(await deliver(w, 'doc_contrato', 'inline')).toMatchObject({ kind: 'redirect' });
  });

  it('logs no DOWNLOAD when the delivery cannot be built', async () => {
    const w = await seeded();
    w.files.execute = () => Promise.reject(new Error('storage down'));
    await expect(deliver(w, 'doc_contrato', 'attachment')).rejects.toThrow('storage down');
    expect(w.accessLog.rows).toEqual([]);
  });

  it('answers NOT_FOUND for a document outside the link and for a dead token', async () => {
    const w = await seeded();
    await expect(deliver(w, 'doc_other', 'inline')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      w.getDelivery.execute({
        token: OTHER_TOKEN,
        documentId: 'doc_prd',
        disposition: 'inline',
        visitor: visitor(),
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
