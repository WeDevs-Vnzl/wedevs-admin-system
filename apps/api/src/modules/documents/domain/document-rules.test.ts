import { describe, expect, it } from 'vitest';
import { DOCUMENT_STATUS_VALUES } from '../../../shared/domain/enums';
import {
  DOCUMENT_STATUS_TRANSITIONS,
  USER_SETTABLE_DOCUMENT_STATUS_VALUES,
  assertDocumentDates,
  assertDocumentTypeRules,
  assertHttpUrlForLink,
  assertMarkdownDocument,
  assertStatusChange,
  assertVersionAllowed,
  canTransitionDocument,
  documentTypeRuleIssues,
  isExpiredDocument,
  isHttpUrl,
  isVersionLocked,
} from './document-rules';
import { DOCUMENT_ERRORS, DOCUMENT_VALIDATION_MESSAGES } from './errors';

const plainType = { requiresSignature: false, hasExpiration: false };
const signedType = { requiresSignature: true, hasExpiration: false };
const expiringType = { requiresSignature: false, hasExpiration: true };

const failure = (fn: () => void): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  return undefined;
};

describe('type rules: signedAt only with signature, expiresAt only with expiration', () => {
  const dates = { signedAt: '2026-09-01', expiresAt: '2027-09-01' };

  it('reports each violation on its field with the mock keys', () => {
    expect(documentTypeRuleIssues(plainType, dates)).toEqual([
      { path: 'signedAt', message: DOCUMENT_VALIDATION_MESSAGES.signedAtNotAllowed },
      { path: 'expiresAt', message: DOCUMENT_VALIDATION_MESSAGES.expiresAtNotAllowed },
    ]);
    expect(documentTypeRuleIssues({ requiresSignature: true, hasExpiration: true }, dates)).toEqual(
      [],
    );
    expect(documentTypeRuleIssues(plainType, { status: 'FIRMADO' })).toEqual([
      { path: 'status', message: DOCUMENT_VALIDATION_MESSAGES.signedStatusNotAllowed },
    ]);
  });

  it('keeps the literal i18n keys of the mock', () => {
    expect(DOCUMENT_VALIDATION_MESSAGES).toEqual({
      signedAtNotAllowed: 'documents.validation.signedAtNotAllowed',
      expiresAtNotAllowed: 'documents.validation.expiresAtNotAllowed',
      signedStatusNotAllowed: 'documents.validation.signedStatusNotAllowed',
    });
    expect(DOCUMENT_ERRORS.invalidTransition).toBe('documents.errors.invalidTransition');
  });

  it('assertDocumentTypeRules throws VALIDATION with the field errors, without any DTO', () => {
    expect(failure(() => assertDocumentTypeRules(plainType, { ...dates }))).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        signedAt: [DOCUMENT_VALIDATION_MESSAGES.signedAtNotAllowed],
        expiresAt: [DOCUMENT_VALIDATION_MESSAGES.expiresAtNotAllowed],
      },
    });
    expect(() => assertDocumentTypeRules(signedType, { signedAt: '2026-09-01' })).not.toThrow();
    expect(() => assertDocumentTypeRules(signedType, { expiresAt: '2027-09-01' })).toThrowError(
      expect.objectContaining({ code: 'VALIDATION' }),
    );
    expect(() => assertDocumentTypeRules(expiringType, { expiresAt: '2027-09-01' })).not.toThrow();
    expect(() => assertDocumentTypeRules(plainType, {})).not.toThrow();
  });

  it('expiry cannot precede the effective date', () => {
    expect(
      failure(() => assertDocumentDates({ effectiveDate: '2026-09-02', expiresAt: '2026-09-01' })),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { expiresAt: ['validation.date.invalid'] },
    });
    expect(() =>
      assertDocumentDates({ effectiveDate: '2026-09-01', expiresAt: '2026-09-01' }),
    ).not.toThrow();
    expect(() => assertDocumentDates({ expiresAt: '2026-09-01' })).not.toThrow();
  });
});

describe('statuses and transitions (PRD §8.9.4)', () => {
  it('transition table covers every status and follows the PRD', () => {
    expect(Object.keys(DOCUMENT_STATUS_TRANSITIONS).sort()).toEqual(
      [...DOCUMENT_STATUS_VALUES].sort(),
    );
    const caps = signedType;
    expect(canTransitionDocument('BORRADOR', 'EN_REVISION', caps)).toBe(true);
    expect(canTransitionDocument('EN_REVISION', 'BORRADOR', caps)).toBe(true);
    expect(canTransitionDocument('EN_REVISION', 'APROBADO', caps)).toBe(true);
    expect(canTransitionDocument('APROBADO', 'ENVIADO', caps)).toBe(true);
    expect(canTransitionDocument('ENVIADO', 'FIRMADO', caps)).toBe(true);
    expect(canTransitionDocument('ENVIADO', 'FIRMADO', plainType)).toBe(false);
    expect(canTransitionDocument('BORRADOR', 'APROBADO', caps)).toBe(false);
    expect(canTransitionDocument('BORRADOR', 'FIRMADO', caps)).toBe(false);
    for (const status of DOCUMENT_STATUS_VALUES) {
      expect(canTransitionDocument(status, 'ANULADO', caps), status).toBe(
        status !== 'VENCIDO' && status !== 'ANULADO',
      );
      expect(canTransitionDocument('VENCIDO', status, caps)).toBe(false);
    }
  });

  it('VENCIDO is never user settable', () => {
    expect(USER_SETTABLE_DOCUMENT_STATUS_VALUES).not.toContain('VENCIDO');
    expect(USER_SETTABLE_DOCUMENT_STATUS_VALUES).toContain('ANULADO');
    expect(
      failure(() => assertStatusChange('ENVIADO', 'VENCIDO', signedType, undefined)),
    ).toMatchObject({ code: 'VALIDATION', fieldErrors: { status: ['validation.invalidOption'] } });
  });

  it('FIRMADO requires the signature date', () => {
    expect(
      failure(() => assertStatusChange('ENVIADO', 'FIRMADO', signedType, undefined)),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { signedAt: ['validation.required'] },
    });
    expect(() => assertStatusChange('ENVIADO', 'FIRMADO', signedType, '2026-09-01')).not.toThrow();
  });

  it('FIRMADO only exists on types with signature', () => {
    expect(
      failure(() => assertStatusChange('ENVIADO', 'FIRMADO', plainType, '2026-09-01')),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: {
        status: expect.arrayContaining([DOCUMENT_VALIDATION_MESSAGES.signedStatusNotAllowed]),
      },
    });
    expect(() => assertStatusChange('APROBADO', 'ENVIADO', plainType, undefined)).not.toThrow();
  });

  it('a transition outside the table is VALIDATION on status with the invalidTransition key', () => {
    expect(
      failure(() => assertStatusChange('BORRADOR', 'APROBADO', plainType, undefined)),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { status: [DOCUMENT_ERRORS.invalidTransition] },
    });
    expect(
      failure(() => assertStatusChange('VENCIDO', 'ANULADO', plainType, undefined)),
    ).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { status: [DOCUMENT_ERRORS.invalidTransition] },
    });
  });
});

describe('document expiry (DT-138)', () => {
  const today = '2026-10-31';

  it('expires every live status except ANULADO and VENCIDO when expiresAt is before today', () => {
    for (const status of DOCUMENT_STATUS_VALUES) {
      const expected = status !== 'ANULADO' && status !== 'VENCIDO';
      expect(
        isExpiredDocument({ status, expiresAt: '2026-10-30', archived: false }, today),
        status,
      ).toBe(expected);
    }
  });

  it('does not expire on the expiry day itself, without a date, or when archived', () => {
    expect(
      isExpiredDocument({ status: 'ENVIADO', expiresAt: '2026-10-31', archived: false }, today),
    ).toBe(false);
    expect(isExpiredDocument({ status: 'ENVIADO', expiresAt: null, archived: false }, today)).toBe(
      false,
    );
    expect(
      isExpiredDocument({ status: 'ENVIADO', expiresAt: '2026-01-01', archived: true }, today),
    ).toBe(false);
  });
});

describe('version lock (C19, DT-138)', () => {
  it('locks FIRMADO, and VENCIDO only with signedAt', () => {
    expect(isVersionLocked({ status: 'FIRMADO', signedAt: '2026-09-01' })).toBe(true);
    expect(isVersionLocked({ status: 'FIRMADO', signedAt: null })).toBe(true);
    expect(isVersionLocked({ status: 'VENCIDO', signedAt: '2026-09-01' })).toBe(true);
    expect(isVersionLocked({ status: 'VENCIDO', signedAt: null })).toBe(false);
    expect(isVersionLocked({ status: 'ENVIADO', signedAt: '2026-09-01' })).toBe(false);
    expect(isVersionLocked({ status: 'BORRADOR', signedAt: null })).toBe(false);
  });

  it('assertVersionAllowed throws INTEGRITY_LOCK', () => {
    expect(
      failure(() => assertVersionAllowed({ status: 'FIRMADO', signedAt: '2026-09-01' })),
    ).toMatchObject({
      code: 'INTEGRITY_LOCK',
    });
    expect(
      failure(() => assertVersionAllowed({ status: 'VENCIDO', signedAt: '2026-09-01' })),
    ).toMatchObject({
      code: 'INTEGRITY_LOCK',
    });
    expect(() => assertVersionAllowed({ status: 'VENCIDO', signedAt: null })).not.toThrow();
    expect(() => assertVersionAllowed({ status: 'APROBADO', signedAt: null })).not.toThrow();
  });
});

describe('markdown-only draft and link URL', () => {
  it('the editor writes markdown documents only: the current format, else the type default', () => {
    expect(() => assertMarkdownDocument('MARKDOWN', 'ARCHIVO')).not.toThrow();
    expect(() => assertMarkdownDocument(null, 'MARKDOWN')).not.toThrow();
    expect(failure(() => assertMarkdownDocument('ARCHIVO', 'MARKDOWN'))).toMatchObject({
      code: 'CONFLICT',
    });
    expect(failure(() => assertMarkdownDocument(null, 'ENLACE'))).toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('accepts only http(s) URLs with a host', () => {
    expect(isHttpUrl('https://example.com/a')).toBe(true);
    expect(isHttpUrl('http://example.com')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('data:text/html,x')).toBe(false);
    expect(isHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl(`https://example.com/${'a'.repeat(2048)}`)).toBe(false);
    expect(assertHttpUrlForLink(' https://example.com/x ')).toBe('https://example.com/x');
    expect(failure(() => assertHttpUrlForLink('ftp://example.com'))).toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { url: ['validation.invalidFormat'] },
    });
  });
});
