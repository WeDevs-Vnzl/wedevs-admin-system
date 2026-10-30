import { describe, expect, it } from 'vitest';
import {
  CLIENT_DIFF_FIELDS,
  CLIENT_SORT_FIELDS,
  COUNTRY_CODE_VALUES,
  clientChanges,
  clientSearchEntry,
  isCountryCode,
  normalizeClient,
  toClientRef,
  type ClientInput,
  type ClientRecord,
} from './client';

const input = (over: Partial<ClientInput> = {}): ClientInput => ({
  kind: 'EMPRESA',
  tradeName: 'Nube Austral',
  legalName: 'Nube Austral C.A.',
  taxId: 'J-40111222-3',
  country: 'VE',
  address: 'Av. Principal, Caracas',
  phone: '+584121234567',
  ...over,
});

const failure = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return error as { code: string; fieldErrors?: Record<string, string[]> };
  }
  throw new Error('expected a failure');
};

describe('normalizeClient', () => {
  it('trims the fields and stores the canonical RIF for VE', () => {
    const { values, tagIds } = normalizeClient(
      input({
        tradeName: '  Nube Austral ',
        taxId: ' j401112223 ',
        email: ' hola@nube.example.com ',
      }),
    );
    expect(values).toMatchObject({
      tradeName: 'Nube Austral',
      taxId: 'J-40111222-3',
      email: 'hola@nube.example.com',
      website: null,
    });
    expect(tagIds).toEqual([]);
  });

  it("stores a PERSONA's legal name as the trade name when it is empty", () => {
    const { values } = normalizeClient(
      input({ kind: 'PERSONA', legalName: undefined, taxId: 'v123456789' }),
    );
    expect(values).toMatchObject({ legalName: 'Nube Austral', taxId: 'V-12345678-9' });
  });

  it('keeps a company legal name and requires it for EMPRESA (CA1)', () => {
    expect(failure(() => normalizeClient(input({ legalName: '  ' }))).fieldErrors).toEqual({
      legalName: ['validation.required'],
    });
    expect(failure(() => normalizeClient(input({ legalName: null }))).code).toBe('VALIDATION');
  });

  it('stores a non-VE tax id trimmed and accepts any text', () => {
    const { values } = normalizeClient(input({ country: 'CO', taxId: ' 900.123.456-1 ' }));
    expect(values.taxId).toBe('900.123.456-1');
  });

  it('reports every failing field together', () => {
    const error = failure(() =>
      normalizeClient(
        input({
          tradeName: '',
          taxId: '123',
          address: 'x'.repeat(501),
          phone: '04121234567',
          email: 'nope',
          website: 'javascript:alert(1)',
          tagIds: ['a', 'a'],
        }),
      ),
    );
    expect(error.code).toBe('VALIDATION');
    expect(error.fieldErrors).toEqual({
      tradeName: ['validation.required'],
      taxId: ['validation.invalidFormat'],
      address: ['validation.tooLong'],
      phone: ['validation.invalidFormat'],
      email: ['validation.invalidEmail'],
      website: ['validation.invalidFormat'],
      tagIds: ['validation.invalidOption'],
    });
  });

  it('rejects a country outside ISO 3166-1', () => {
    expect(failure(() => normalizeClient(input({ country: 'ZZ' }))).fieldErrors).toEqual({
      country: ['validation.invalidOption'],
    });
  });

  it('knows the 249 assigned country codes', () => {
    expect(COUNTRY_CODE_VALUES).toHaveLength(249);
    expect(isCountryCode('VE')).toBe(true);
    expect(isCountryCode('XX')).toBe(false);
  });
});

describe('clientChanges', () => {
  const before = normalizeClient(input()).values;

  it('records changed fields as [before, after] and long texts as "changed"', () => {
    const after = {
      ...before,
      tradeName: 'Nube Austral Pro',
      address: 'Otra dirección',
      email: 'hola@nube.example.com',
    };
    expect(clientChanges(before, after, { before: '', after: '' })).toEqual({
      tradeName: ['Nube Austral', 'Nube Austral Pro'],
      address: 'changed',
      email: [null, 'hola@nube.example.com'],
    });
  });

  it('records tag names, never ids', () => {
    expect(clientChanges(before, before, { before: '', after: 'Alfa, Beta' })).toEqual({
      tagIds: ['', 'Alfa, Beta'],
    });
  });

  it('is null when nothing changed', () => {
    expect(clientChanges(before, { ...before }, { before: 'A', after: 'A' })).toBeNull();
    expect(CLIENT_DIFF_FIELDS).not.toContain('status');
  });
});

describe('projections', () => {
  const record: ClientRecord = {
    ...normalizeClient(input()).values,
    id: 'cli_1',
    code: 'CLI-0001',
    status: 'PROSPECTO',
    activatedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
  };

  it('builds the entity ref and the search entry', () => {
    expect(toClientRef(record)).toEqual({
      type: 'CLIENT',
      id: 'cli_1',
      code: 'CLI-0001',
      label: 'Nube Austral',
    });
    expect(clientSearchEntry(record)).toEqual({
      entityType: 'CLIENT',
      entityId: 'cli_1',
      code: 'CLI-0001',
      title: 'Nube Austral',
      subtitle: 'Nube Austral C.A.',
      body: 'J-40111222-3',
      status: 'PROSPECTO',
      archived: false,
    });
    expect(clientSearchEntry({ ...record, deletedAt: new Date() }).archived).toBe(true);
  });

  it('lists the sort keys of the contract', () => {
    expect(CLIENT_SORT_FIELDS).toContain('receivableUsd');
    expect(CLIENT_SORT_FIELDS).toHaveLength(10);
  });
});
