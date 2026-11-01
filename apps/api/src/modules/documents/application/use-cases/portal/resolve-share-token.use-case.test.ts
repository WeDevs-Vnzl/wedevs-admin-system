import { describe, expect, it } from 'vitest';
import {
  createPortalWorld,
  OTHER_TOKEN,
  TOKEN,
  visitor,
} from '../../../../../../test/documents/portal/world';

// Ported from `portal-shares.test.ts` (`findLiveShareLink`, `resolveShareToken`) and the C22 rules of HU-22
// CA2-CA4. Every refusal about the link is the same bare NOT_FOUND.

const KAIROS_DOCS = [
  { id: 'doc_contrato', title: 'Contrato', format: 'ARCHIVO' as const, versionNumber: 2 },
  { id: 'doc_prd', title: 'PRD' },
  { id: 'doc_cred', title: 'Credenciales', key: 'KAIRO-STAGE-2026', format: 'ENLACE' as const },
];

describe('ResolveShareToken', () => {
  it('returns the portal page with only what a visitor may see', async () => {
    const w = createPortalWorld();
    w.noteTargets.add('CLIENT', 'cli_k', 'Kairos Studio');
    await w.seedLink(KAIROS_DOCS, { title: 'Entrega — Kairos Studio', clientId: 'cli_k' });

    const page = await w.resolve.execute({ token: TOKEN, visitor: visitor() });

    expect(page).toMatchObject({
      title: 'Entrega — Kairos Studio',
      message: null,
      locale: 'es',
      allowDownload: true,
      clientName: 'Kairos Studio',
      expiresAt: null,
    });
    expect(page.documents.map((doc) => doc.documentId)).toEqual([
      'doc_contrato',
      'doc_prd',
      'doc_cred',
    ]);
    expect(page.documents.map((doc) => doc.locked)).toEqual([false, false, true]);
    expect(page.documents[0]).toMatchObject({
      versionNumber: 2,
      format: 'ARCHIVO',
      typeName: 'Acuerdo de confidencialidad',
      typeNameEn: 'NDA',
      versionDate: '2026-10-20',
    });
    expect(Object.keys(page.documents[0] ?? {}).sort()).toEqual([
      'documentId',
      'format',
      'locked',
      'title',
      'typeName',
      'typeNameEn',
      'versionDate',
      'versionNumber',
    ]);
    expect(JSON.stringify(page)).not.toMatch(/scrypt|accessKey|ipHash|shr_|usr_|storageKey/);
  });

  it('has no side effect: it writes no access-log row and moves no counter', async () => {
    const w = createPortalWorld();
    await w.seedLink(KAIROS_DOCS);
    await w.resolve.execute({ token: TOKEN, visitor: visitor() });
    expect(w.accessLog.rows).toEqual([]);
    expect(w.accessLog.countersOf('shr_a').viewCount).toBe(0);
  });

  it('reports a key-protected document as unlocked once its id comes from the signed cookie', async () => {
    const w = createPortalWorld();
    await w.seedLink(KAIROS_DOCS);
    const page = await w.resolve.execute({
      token: TOKEN,
      visitor: visitor({ unlockCookie: w.cookieFor(['doc_cred']) }),
    });
    expect(page.documents.find((doc) => doc.documentId === 'doc_cred')?.locked).toBe(false);
  });

  it('ignores a forged cookie and the cookie of another link', async () => {
    const w = createPortalWorld();
    await w.seedLink(KAIROS_DOCS);
    const forged = `${w.cookieFor(['doc_cred']).split('.')[0]}.AAAA`;
    for (const unlockCookie of [forged, w.cookieFor(['doc_cred'], OTHER_TOKEN), 'garbage']) {
      const page = await w.resolve.execute({ token: TOKEN, visitor: visitor({ unlockCookie }) });
      expect(page.documents.find((doc) => doc.documentId === 'doc_cred')?.locked).toBe(true);
    }
  });

  it('answers the same bare NOT_FOUND for unknown, malformed, revoked and expired tokens', async () => {
    const w = createPortalWorld();
    await w.seedLink(KAIROS_DOCS, { id: 'shr_a', token: TOKEN });
    await w.seedLink(KAIROS_DOCS, { id: 'shr_r', token: 'R'.repeat(43), revokedAt: w.clock.now() });
    await w.seedLink(KAIROS_DOCS, { id: 'shr_e', token: 'E'.repeat(43), expiresAt: '2026-10-29' });

    const errors = [];
    for (const token of ['Z'.repeat(43), 'short', '', 'R'.repeat(43), 'E'.repeat(43)]) {
      errors.push(
        await w.resolve.execute({ token, visitor: visitor() }).catch((error: unknown) => error),
      );
    }
    for (const error of errors) {
      expect(error).toMatchObject({
        code: 'NOT_FOUND',
        message: 'common.errors.NOT_FOUND',
      });
    }
    expect(new Set(errors.map((error) => JSON.stringify(error))).size).toBe(1);
  });

  it('serves a link through its last valid day and refuses it the day after (Caracas)', async () => {
    const w = createPortalWorld();
    await w.seedLink(KAIROS_DOCS, { expiresAt: '2026-10-30' });
    await expect(w.resolve.execute({ token: TOKEN, visitor: visitor() })).resolves.toBeDefined();
    // 2026-10-31T04:00Z is 00:00 on the 31st in Caracas (UTC-4).
    w.clock.set('2026-10-31T04:00:00.000Z');
    await expect(w.resolve.execute({ token: TOKEN, visitor: visitor() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses an expired link whose expiredAt marker is still null', async () => {
    const w = createPortalWorld();
    await w.seedLink(KAIROS_DOCS, { expiresAt: '2026-10-01', expiredAt: null });
    await expect(w.resolve.execute({ token: TOKEN, visitor: visitor() })).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('leaves out a shared document that was archived since', async () => {
    const w = createPortalWorld();
    const link = await w.seedLink(KAIROS_DOCS);
    w.archive(link.id, 'doc_prd');
    const page = await w.resolve.execute({ token: TOKEN, visitor: visitor() });
    expect(page.documents.map((doc) => doc.documentId)).toEqual(['doc_contrato', 'doc_cred']);
  });
});
