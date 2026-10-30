import { describe, expect, it } from 'vitest';
import type { FieldErrors } from '../../../shared/domain/domain-error';
import {
  isE164Phone,
  isEmail,
  isHttpUrl,
  optionalEmail,
  optionalHttpUrl,
  optionalText,
  requiredText,
  tagIdList,
  tagNamesSnapshot,
} from './client-fields';

describe('text checks', () => {
  it('trims required text and reports empty and too long values', () => {
    const errors: FieldErrors = {};
    expect(requiredText(errors, 'a', '  Nube  ', 10)).toBe('Nube');
    expect(errors).toEqual({});
    requiredText(errors, 'b', '   ', 10);
    requiredText(errors, 'c', 'x'.repeat(11), 10);
    expect(errors).toEqual({ b: ['validation.required'], c: ['validation.tooLong'] });
  });

  it('turns blank optional text into null and reports too long values', () => {
    const errors: FieldErrors = {};
    expect(optionalText(errors, 'a', '   ', 5)).toBeNull();
    expect(optionalText(errors, 'a', undefined, 5)).toBeNull();
    expect(optionalText(errors, 'a', ' ab ', 5)).toBe('ab');
    optionalText(errors, 'b', 'abcdef', 5);
    expect(errors).toEqual({ b: ['validation.tooLong'] });
  });
});

describe('format checks', () => {
  it('validates E.164 phones', () => {
    expect(isE164Phone('+584121234567')).toBe(true);
    for (const value of ['04121234567', '+0123456789', '+58 412 1234567', '+12345']) {
      expect(isE164Phone(value)).toBe(false);
    }
  });

  it('validates e-mails and http(s) urls only', () => {
    expect(isEmail('hola@nube.example.com')).toBe(true);
    expect(isEmail('hola@')).toBe(false);
    expect(isHttpUrl('https://kairos.example.com')).toBe(true);
    for (const value of ['javascript:alert(1)', 'ftp://x.test', 'no url', 'data:text/html,x']) {
      expect(isHttpUrl(value)).toBe(false);
    }
  });

  it('keys optional e-mail and url errors', () => {
    const errors: FieldErrors = {};
    expect(optionalEmail(errors, 'email', '')).toBeNull();
    expect(optionalHttpUrl(errors, 'website', undefined)).toBeNull();
    optionalEmail(errors, 'email', 'nope');
    optionalHttpUrl(errors, 'website', 'javascript:1');
    expect(errors).toEqual({
      email: ['validation.invalidEmail'],
      website: ['validation.invalidFormat'],
    });
  });
});

describe('tagIdList', () => {
  it('rejects repeats and more than 50 ids', () => {
    const errors: FieldErrors = {};
    expect(tagIdList(errors, 'tagIds', ['a', 'b'])).toEqual(['a', 'b']);
    expect(tagIdList(errors, 'tagIds', undefined)).toEqual([]);
    expect(errors).toEqual({});
    tagIdList(errors, 'tagIds', ['a', 'a']);
    expect(errors).toEqual({ tagIds: ['validation.invalidOption'] });
    tagIdList(
      errors,
      'tagIds',
      Array.from({ length: 51 }, (_, i) => `t${i}`),
    );
    expect(errors).toEqual({ tagIds: ['validation.tooLong'] });
  });
});

describe('tagNamesSnapshot', () => {
  it('sorts names in Spanish order and joins them with ", "', () => {
    expect(tagNamesSnapshot(['zeta', 'Álamo', 'beta'])).toBe('Álamo, beta, zeta');
    expect(tagNamesSnapshot([])).toBe('');
  });
});
