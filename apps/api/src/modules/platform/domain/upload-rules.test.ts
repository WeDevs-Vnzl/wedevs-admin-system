import { describe, expect, it } from 'vitest';
import {
  FILE_VALIDATION_KEYS as K,
  UPLOAD_RULES,
  checkUpload,
  getUploadRules,
  isSafeFileName,
  normalizeMime,
  resolveDeclaredMime,
} from './upload-rules';

const MB = 1024 * 1024;

describe('upload rules per context (DT-41, C23)', () => {
  it('general: 25 MB; payment receipts: 10 MB', () => {
    expect(UPLOAD_RULES.general.maxBytes).toBe(25 * MB);
    expect(UPLOAD_RULES.payment_receipt.maxBytes).toBe(10 * MB);
    expect(getUploadRules('general')).toBe(UPLOAD_RULES.general);
  });

  it('general allows PDF, images, DOCX, XLSX, PPTX, MD, TXT and ZIP', () => {
    for (const mime of [
      'application/pdf',
      'image/png',
      'image/jpeg',
      'image/webp',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'text/markdown',
      'text/plain',
      'application/zip',
    ]) {
      expect(UPLOAD_RULES.general.allowedMimeTypes).toContain(mime);
    }
  });

  it('never allows executable or scriptable types (SVG, HTML, JS)', () => {
    for (const rules of Object.values(UPLOAD_RULES)) {
      for (const mime of [
        'image/svg+xml',
        'text/html',
        'application/javascript',
        'application/x-msdownload',
      ]) {
        expect(rules.allowedMimeTypes).not.toContain(mime);
      }
    }
  });

  it('payment receipts allow only PDF, PNG, JPG and WEBP', () => {
    expect([...UPLOAD_RULES.payment_receipt.allowedMimeTypes].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(UPLOAD_RULES.payment_receipt.allowedExtensions).toEqual([
      '.pdf',
      '.png',
      '.jpg',
      '.jpeg',
      '.webp',
    ]);
  });
});

describe('checkUpload', () => {
  const pdf = { name: 'a.pdf', mime: 'application/pdf' };
  const typeNotAllowed = { key: K.typeNotAllowed };

  it('accepts a file at the limit of each context', () => {
    expect(checkUpload({ ...pdf, size: 25 * MB }, 'general')).toBeNull();
    expect(
      checkUpload({ name: 'r.pdf', mime: pdf.mime, size: 10 * MB }, 'payment_receipt'),
    ).toBeNull();
  });

  it('rejects files over the limit and provides {max} as a number of MB', () => {
    expect(checkUpload({ ...pdf, size: 25 * MB + 1 }, 'general')).toEqual({
      key: K.tooLargeMax,
      values: { max: 25 },
    });
    expect(
      checkUpload({ name: 'r.pdf', mime: pdf.mime, size: 10 * MB + 1 }, 'payment_receipt'),
    ).toEqual({ key: K.tooLargeMax, values: { max: 10 } });
  });

  it('applies the limit of the context, not a global one', () => {
    expect(checkUpload({ ...pdf, size: 20 * MB }, 'general')).toBeNull();
    expect(checkUpload({ ...pdf, size: 20 * MB }, 'payment_receipt')).toMatchObject({
      key: K.tooLargeMax,
    });
    expect(
      checkUpload({ name: 'a.zip', mime: 'application/zip', size: 1 * MB }, 'payment_receipt'),
    ).toEqual(typeNotAllowed);
  });

  it('rejects empty files and unknown types, and ignores MIME case', () => {
    expect(checkUpload({ ...pdf, size: 0 }, 'general')).toEqual({ key: K.empty });
    expect(
      checkUpload({ name: 'a.exe', mime: 'application/x-msdownload', size: 10 }, 'general'),
    ).toEqual(typeNotAllowed);
    expect(checkUpload({ name: 'a.PNG', mime: 'IMAGE/PNG', size: 10 }, 'general')).toBeNull();
  });

  it('strips MIME parameters', () => {
    expect(
      checkUpload({ name: 'n.txt', mime: 'text/plain; charset=utf-8', size: 10 }, 'general'),
    ).toBeNull();
    expect(
      checkUpload({ name: 'n.md', mime: ' Text/Markdown ;charset=UTF-8', size: 10 }, 'general'),
    ).toBeNull();
    expect(
      checkUpload(
        { name: 'a.exe', mime: 'application/x-msdownload; foo=bar', size: 10 },
        'general',
      ),
    ).toEqual(typeNotAllowed);
  });

  it('falls back to the extension when the MIME is empty or octet-stream', () => {
    for (const mime of ['', 'application/octet-stream', 'Application/Octet-Stream; x=1']) {
      expect(checkUpload({ name: 'notes.md', mime, size: 10 }, 'general'), mime).toBeNull();
    }
    expect(checkUpload({ name: 'NOTES.MD', mime: '', size: 10 }, 'general')).toBeNull();
  });

  it('still rejects a disallowed or missing extension when the MIME is empty or generic', () => {
    for (const mime of ['', 'application/octet-stream']) {
      for (const name of ['setup.exe', 'page.html', 'image.svg', 'README', '.md', 'notes.md.exe']) {
        expect(checkUpload({ name, mime, size: 10 }, 'general'), `${name} ${mime}`).toEqual(
          typeNotAllowed,
        );
      }
    }
    expect(checkUpload({ name: 'notes.md', mime: '', size: 10 }, 'payment_receipt')).toEqual(
      typeNotAllowed,
    );
  });

  it('does not let the extension override a concrete, disallowed MIME', () => {
    expect(checkUpload({ name: 'notes.md', mime: 'text/html', size: 10 }, 'general')).toEqual(
      typeNotAllowed,
    );
  });
});

describe('isSafeFileName', () => {
  it('accepts ordinary names', () => {
    expect(isSafeFileName('contract.pdf')).toBe(true);
    expect(isSafeFileName('x'.repeat(255))).toBe(true);
  });

  it('rejects empty, long, path-like, padded and control-character names', () => {
    for (const name of [
      '',
      '../etc/passwd',
      'a/b.pdf',
      'a\\b.pdf',
      ' a.pdf',
      'a.pdf ',
      '..',
      '.',
      'a\u0000.pdf',
      'a\u007f.pdf',
      'x'.repeat(256),
    ]) {
      expect(isSafeFileName(name), JSON.stringify(name)).toBe(false);
    }
  });
});

describe('MIME normalization and resolution', () => {
  it('normalizes case, whitespace and parameters', () => {
    expect(normalizeMime(' Application/PDF ; charset=binary')).toBe('application/pdf');
  });

  it('keeps a concrete declared type and derives one from the extension otherwise', () => {
    expect(resolveDeclaredMime('image/png', 'x.pdf')).toBe('image/png');
    expect(resolveDeclaredMime('', 'notes.MD')).toBe('text/markdown');
    expect(resolveDeclaredMime('application/octet-stream', 'a.docx')).toContain('wordprocessing');
    expect(resolveDeclaredMime('', 'README')).toBe('');
  });
});
