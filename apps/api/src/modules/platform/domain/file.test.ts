import { describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  contextOfStorageKey,
  createPendingFile,
  isUtf8Text,
  verifyContentType,
} from './file';

describe('storage key', () => {
  it('is <context>/<yyyy>/<mm>/<id> in UTC and never carries the file name', () => {
    expect(buildStorageKey('general', 'abc', new Date('2026-01-31T23:59:59Z'))).toBe(
      'general/2026/01/abc',
    );
    expect(buildStorageKey('payment_receipt', 'abc', new Date('2026-12-01T00:00:00Z'))).toBe(
      'payment_receipt/2026/12/abc',
    );
  });

  it('recovers the context of a key and rejects foreign prefixes', () => {
    expect(contextOfStorageKey('payment_receipt/2026/10/x')).toBe('payment_receipt');
    expect(contextOfStorageKey('evil/2026/10/x')).toBeNull();
    expect(contextOfStorageKey('toString/x')).toBeNull();
  });
});

describe('createPendingFile', () => {
  it('starts PENDING and not deleted, owned by the uploader', () => {
    const file = createPendingFile({
      id: 'f1',
      context: 'general',
      bucket: 'b',
      originalName: 'a.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      uploadedById: 'u1',
      now: new Date('2026-10-25T10:00:00Z'),
    });
    expect(file).toMatchObject({
      status: 'PENDING',
      deletedAt: null,
      uploadedById: 'u1',
      storageKey: 'general/2026/10/f1',
    });
  });
});

describe('verifyContentType', () => {
  const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

  it('accepts a sniffed type that is allowed and equals the declared one', () => {
    expect(
      verifyContentType({
        context: 'general',
        declaredMime: 'application/pdf',
        sniffed: 'application/pdf',
        headIsText: false,
      }),
    ).toEqual({ ok: true, mimeType: 'application/pdf' });
  });

  it('rejects a sniffed type outside the context allowlist (spoofed executable)', () => {
    expect(
      verifyContentType({
        context: 'general',
        declaredMime: 'application/pdf',
        sniffed: 'application/x-msdownload',
        headIsText: false,
      }),
    ).toEqual({ ok: false });
  });

  it('rejects an allowed sniffed type that differs from the declared one', () => {
    expect(
      verifyContentType({
        context: 'general',
        declaredMime: 'application/pdf',
        sniffed: 'image/png',
        headIsText: false,
      }),
    ).toEqual({ ok: false });
  });

  it('applies the allowlist of the context', () => {
    expect(
      verifyContentType({
        context: 'payment_receipt',
        declaredMime: 'application/zip',
        sniffed: 'application/zip',
        headIsText: false,
      }),
    ).toEqual({ ok: false });
  });

  it('keeps the declared Office type when the sniffer only sees a ZIP', () => {
    expect(
      verifyContentType({
        context: 'general',
        declaredMime: docx,
        sniffed: 'application/zip',
        headIsText: false,
      }),
    ).toEqual({ ok: true, mimeType: docx });
    expect(
      verifyContentType({
        context: 'general',
        declaredMime: 'application/pdf',
        sniffed: 'application/zip',
        headIsText: false,
      }),
    ).toEqual({ ok: false });
  });

  it('accepts text only when declared as text and the head is UTF-8 text', () => {
    const base = { context: 'general', sniffed: null } as const;
    expect(verifyContentType({ ...base, declaredMime: 'text/markdown', headIsText: true })).toEqual(
      { ok: true, mimeType: 'text/markdown' },
    );
    expect(verifyContentType({ ...base, declaredMime: 'text/plain', headIsText: false })).toEqual({
      ok: false,
    });
    expect(
      verifyContentType({ ...base, declaredMime: 'application/pdf', headIsText: true }),
    ).toEqual({ ok: false });
    expect(
      verifyContentType({
        context: 'payment_receipt',
        sniffed: null,
        declaredMime: 'text/plain',
        headIsText: true,
      }),
    ).toEqual({ ok: false });
  });
});

describe('isUtf8Text', () => {
  it('accepts UTF-8, including a truncated trailing multi-byte sequence', () => {
    expect(isUtf8Text(new TextEncoder().encode('# Título\n'))).toBe(true);
    const bytes = new TextEncoder().encode('ñ');
    expect(isUtf8Text(bytes.slice(0, 1))).toBe(true);
  });

  it('rejects NUL bytes and invalid UTF-8', () => {
    expect(isUtf8Text(new Uint8Array([0x61, 0x00, 0x62]))).toBe(false);
    expect(isUtf8Text(new Uint8Array([0xff, 0xfe, 0x41]))).toBe(false);
  });
});
