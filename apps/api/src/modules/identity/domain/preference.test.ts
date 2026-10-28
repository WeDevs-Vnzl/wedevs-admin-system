import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMEZONE,
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  buildPreferences,
  isValidPreferenceKey,
  isValidTableId,
  isValidTimezone,
  parsePreferenceInput,
  parseTableColumnsKey,
  parseTableColumnsPreference,
  tableColumnsKey,
} from './preference';

describe('timezone (DT-43)', () => {
  it('defaults to America/Caracas, which is a real zone', () => {
    expect(DEFAULT_TIMEZONE).toBe('America/Caracas');
    expect(isValidTimezone(DEFAULT_TIMEZONE)).toBe(true);
  });

  it('rejects unknown or empty zones', () => {
    expect(isValidTimezone('Mars/Olympus')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone('x'.repeat(100))).toBe(false);
  });
});

describe('table column keys', () => {
  it('builds and parses table:<id>:columns', () => {
    expect(tableColumnsKey('clients')).toBe('table:clients:columns');
    expect(parseTableColumnsKey('table:project-links:columns')).toBe('project-links');
    expect(parseTableColumnsKey('table:Bad Id:columns')).toBeNull();
    expect(parseTableColumnsKey('locale')).toBeNull();
  });

  it('table ids are lower-case kebab', () => {
    expect(isValidTableId('clients')).toBe(true);
    for (const bad of ['Clients', 'a_b', '-a', 'a--b', '']) {
      expect(isValidTableId(bad), bad).toBe(false);
    }
  });

  it('accepts the four key families and nothing else', () => {
    for (const key of ['locale', 'theme', 'timezone', 'table:invoices:columns']) {
      expect(isValidPreferenceKey(key), key).toBe(true);
    }
    for (const key of ['language', 'table:invoices:filters', 'table::columns', 'table:X:columns']) {
      expect(isValidPreferenceKey(key), key).toBe(false);
    }
  });
});

describe('column preference value', () => {
  it('fills defaults and validates widths and ids', () => {
    expect(parseTableColumnsPreference({})).toEqual({
      ok: true,
      value: { order: [], visibility: {}, widths: {} },
    });
    expect(
      parseTableColumnsPreference({
        order: ['code', 'tradeName'],
        visibility: { tags: false },
        widths: { code: 120 },
      }).ok,
    ).toBe(true);
    expect(parseTableColumnsPreference({ order: ['a', 'a'] }).ok).toBe(false);
    expect(parseTableColumnsPreference({ widths: { code: 10 } }).ok).toBe(false);
    expect(parseTableColumnsPreference({ widths: { code: 12.5 } }).ok).toBe(false);
    expect(parseTableColumnsPreference({ order: ['1bad'] }).ok).toBe(false);
    expect(parseTableColumnsPreference('wide').ok).toBe(false);
    expect(parseTableColumnsPreference({ visibility: { tags: 'no' } }).ok).toBe(false);
    expect(
      parseTableColumnsPreference({ order: Array.from({ length: 61 }, (_, i) => `c${i}`) }).ok,
    ).toBe(false);
  });

  it('width range is 80-1200 and the parser accepts exactly that range', () => {
    expect([MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH]).toEqual([80, 1200]);
    const parse = (width: number) => parseTableColumnsPreference({ widths: { code: width } }).ok;
    expect(parse(MIN_COLUMN_WIDTH)).toBe(true);
    expect(parse(MAX_COLUMN_WIDTH)).toBe(true);
    expect(parse(MIN_COLUMN_WIDTH - 1)).toBe(false);
    expect(parse(MAX_COLUMN_WIDTH + 1)).toBe(false);
  });
});

describe('parsePreferenceInput (setPreference)', () => {
  it('accepts the value each key allows', () => {
    for (const [key, value] of [
      ['locale', 'en'],
      ['theme', 'dark'],
      ['timezone', 'America/Caracas'],
      ['table:clients:columns', { order: ['code'] }],
    ] as const) {
      expect(parsePreferenceInput(key, value).ok, key).toBe(true);
    }
  });

  it('fills the table defaults in the stored value', () => {
    expect(parsePreferenceInput('table:clients:columns', { order: ['code'] })).toEqual({
      ok: true,
      entry: {
        key: 'table:clients:columns',
        value: { order: ['code'], visibility: {}, widths: {} },
      },
    });
  });

  it('rejects a value the key does not allow, keyed under value', () => {
    for (const [key, value] of [
      ['locale', 'fr'],
      ['theme', 'blue'],
      ['timezone', 'Nowhere/City'],
      ['table:clients:columns', 'wide'],
    ] as const) {
      expect(parsePreferenceInput(key, value), key).toMatchObject({
        ok: false,
        fieldErrors: { value: ['validation.invalidOption'] },
      });
    }
  });

  it('rejects an unknown key, keyed under key', () => {
    expect(parsePreferenceInput('unknown', 'x')).toMatchObject({
      ok: false,
      fieldErrors: { key: ['validation.invalidFormat'] },
    });
  });
});

describe('buildPreferences', () => {
  it('falls back to the user row, then to the defaults', () => {
    expect(buildPreferences({ locale: 'en', theme: 'dark' }, [])).toEqual({
      locale: 'en',
      theme: 'dark',
      timezone: 'America/Caracas',
      tableColumns: {},
    });
    expect(buildPreferences({ locale: 'xx', theme: undefined }, [])).toMatchObject({
      locale: 'es',
      theme: 'system',
    });
  });

  it('stored rows win over the user row', () => {
    const prefs = buildPreferences({ locale: 'en', theme: 'dark' }, [
      { key: 'theme', value: 'light' },
      { key: 'timezone', value: 'America/Bogota' },
      { key: 'locale', value: 'es' },
      { key: 'table:clients:columns', value: { order: ['name'], visibility: {}, widths: {} } },
    ]);
    expect(prefs).toEqual({
      locale: 'es',
      theme: 'light',
      timezone: 'America/Bogota',
      tableColumns: { clients: { order: ['name'], visibility: {}, widths: {} } },
    });
  });

  it('ignores a stored row that no longer parses', () => {
    const prefs = buildPreferences({}, [
      { key: 'theme', value: 'neon' },
      { key: 'locale', value: 7 },
      { key: 'timezone', value: 'Mars/Olympus' },
      { key: 'table:clients:columns', value: 'nope' },
      { key: 'table:Bad:columns', value: {} },
      { key: 'stray', value: 1 },
    ]);
    expect(prefs).toEqual({
      locale: 'es',
      theme: 'system',
      timezone: 'America/Caracas',
      tableColumns: {},
    });
  });
});
