import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from './domain-error';
import { DEFAULT_LIST_QUERY, foldText, parseSort, resolveSort } from './list-query';

describe('foldText', () => {
  it('lower-cases and strips accents', () => {
    expect(foldText('Cotización')).toBe('cotizacion');
    expect(foldText('ÁÉÍÓÚ Ñandú')).toBe('aeiou nandu');
  });
});

describe('parseSort', () => {
  it('splits field and direction', () => {
    expect(parseSort('createdAt:desc')).toEqual({ field: 'createdAt', direction: 'desc' });
    expect(parseSort('client.name:asc')).toEqual({ field: 'client.name', direction: 'asc' });
  });

  it('returns null for missing or malformed values', () => {
    expect(parseSort(undefined)).toBeNull();
    expect(parseSort(null)).toBeNull();
    expect(parseSort('')).toBeNull();
    for (const bad of ['bad', 'name:up', ':asc', '1name:asc', 'name:asc,other:desc']) {
      expect(parseSort(bad)).toBeNull();
    }
  });
});

describe('resolveSort', () => {
  const whitelist = ['name', 'createdAt'];
  const fallback = { field: 'createdAt', direction: 'desc' } as const;

  it('uses the default when nothing is requested', () => {
    expect(resolveSort(undefined, whitelist, fallback)).toBe(fallback);
    expect(resolveSort('', whitelist, fallback)).toBe(fallback);
  });

  it('accepts a whitelisted field', () => {
    expect(resolveSort('name:asc', whitelist, fallback)).toEqual({
      field: 'name',
      direction: 'asc',
    });
  });

  it.each(['nope:asc', 'bad'])('rejects %s with fieldErrors.sort', (requested) => {
    try {
      resolveSort(requested, whitelist, fallback);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationFailedError);
      expect((error as ValidationFailedError).fieldErrors).toEqual({
        sort: ['validation.sort.invalid'],
      });
    }
  });
});

describe('DEFAULT_LIST_QUERY', () => {
  it('is page 1, 25 per page, archived excluded', () => {
    expect(DEFAULT_LIST_QUERY).toMatchObject({
      page: 1,
      pageSize: 25,
      sort: null,
      archived: 'exclude',
    });
  });
});
