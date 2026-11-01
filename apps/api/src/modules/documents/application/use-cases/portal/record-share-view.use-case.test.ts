import { describe, expect, it } from 'vitest';
import {
  createPortalWorld,
  IP_SALT,
  TOKEN,
  visitor,
} from '../../../../../../test/documents/portal/world';
import { NodeShareSecrets } from '../../../infrastructure/node-share-secrets';

// Ported from `portal-shares.test.ts` (`recordShareAccess`) with the contract choices 2 and 4.

const DOCS = [{ id: 'doc_prd' }, { id: 'doc_nda' }];

describe('RecordShareView', () => {
  it('appends a VIEW with the salted IP hash and user agent only, and moves the stored counters', async () => {
    const w = createPortalWorld();
    await w.seedLink(DOCS);
    const result = await w.recordView.execute({ token: TOKEN, visitor: visitor() });
    expect(result).toEqual({ recorded: true });
    expect(w.accessLog.rows).toHaveLength(1);
    expect(w.accessLog.rows[0]).toMatchObject({
      shareLinkId: 'shr_a',
      event: 'VIEW',
      documentId: null,
      userAgent: 'Vitest',
      createdAt: w.clock.now(),
    });
    const hash = new NodeShareSecrets({
      unlockSecret: 'x'.repeat(32),
      ipSalt: IP_SALT,
    }).hashIp('203.0.113.7');
    expect(w.accessLog.rows[0]?.ipHash).toBe(hash);
    expect(JSON.stringify(w.accessLog.rows)).not.toContain('203.0.113.7');
    expect(w.accessLog.countersOf('shr_a')).toMatchObject({
      viewCount: 1,
      downloadCount: 0,
      lastAccessedAt: w.clock.now(),
    });
  });

  it('records the document that was opened', async () => {
    const w = createPortalWorld();
    await w.seedLink(DOCS);
    await w.recordView.execute({ token: TOKEN, documentId: 'doc_prd', visitor: visitor() });
    expect(w.accessLog.rows[0]).toMatchObject({ event: 'VIEW', documentId: 'doc_prd' });
  });

  it('a VIEW of a locked document without the unlock cookie is FORBIDDEN: no row, no counter moved', async () => {
    const w = createPortalWorld();
    await w.seedLink([{ id: 'doc_prd' }, { id: 'doc_nda', key: 'K7QM-2XRP-ABCD' }]);
    await expect(
      w.recordView.execute({ token: TOKEN, documentId: 'doc_nda', visitor: visitor() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(
      w.recordView.execute({
        token: TOKEN,
        documentId: 'doc_nda',
        visitor: visitor({ unlockCookie: w.cookieFor(['doc_prd']) }),
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(w.accessLog.rows).toEqual([]);
    expect(w.accessLog.countersOf('shr_a')).toMatchObject({ viewCount: 0, lastAccessedAt: null });
  });

  it('records a VIEW of a locked document once its cookie unlocks it; the link-level VIEW needs none', async () => {
    const w = createPortalWorld();
    await w.seedLink([{ id: 'doc_prd' }, { id: 'doc_nda', key: 'K7QM-2XRP-ABCD' }]);
    await w.recordView.execute({ token: TOKEN, visitor: visitor() });
    await w.recordView.execute({
      token: TOKEN,
      documentId: 'doc_nda',
      visitor: visitor({ unlockCookie: w.cookieFor(['doc_nda']) }),
    });
    expect(w.accessLog.rows.map((row) => [row.event, row.documentId])).toEqual([
      ['VIEW', null],
      ['VIEW', 'doc_nda'],
    ]);
  });

  it('caps the user agent at 512 characters and stores none when absent', async () => {
    const w = createPortalWorld();
    await w.seedLink(DOCS);
    await w.recordView.execute({
      token: TOKEN,
      visitor: visitor({ userAgent: 'u'.repeat(900) }),
    });
    await w.recordView.execute({ token: TOKEN, visitor: visitor({ userAgent: undefined }) });
    expect(w.accessLog.rows.map((row) => row.userAgent?.length ?? null)).toEqual([512, null]);
  });

  it('refuses a document that is not part of the link, and a dead token, writing nothing', async () => {
    const w = createPortalWorld();
    await w.seedLink(DOCS);
    await expect(
      w.recordView.execute({ token: TOKEN, documentId: 'doc_other', visitor: visitor() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(
      w.recordView.execute({ token: 'Z'.repeat(43), visitor: visitor() }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(w.accessLog.rows).toEqual([]);
  });

  it('runs its write at ReadCommitted and takes no row lock (A1)', async () => {
    const w = createPortalWorld();
    await w.seedLink(DOCS);
    await w.recordView.execute({ token: TOKEN, visitor: visitor() });
    expect(w.uow.lastOptions).toEqual({ isolation: 'ReadCommitted' });
    expect(w.locks.acquired).toEqual([]);
  });
});
