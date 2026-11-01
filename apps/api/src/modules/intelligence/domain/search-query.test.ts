import { describe, expect, it } from 'vitest';
import {
  SEARCHABLE_ENTITY_TYPE_VALUES,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_PREFIXES,
  parseSearchQuery,
  searchLimit,
} from './search-query';

describe('search prefixes (PRD §7.6)', () => {
  it('maps c: p: f: d: n:', () => {
    expect(SEARCH_PREFIXES).toEqual({
      c: 'CLIENT',
      p: 'PROJECT',
      f: 'INVOICE',
      d: 'DOCUMENT',
      n: 'NOTE',
    });
  });

  it('parseSearchQuery splits the prefix from the text', () => {
    expect(parseSearchQuery('c: acme')).toEqual({ text: 'acme', entityType: 'CLIENT' });
    expect(parseSearchQuery('F:FAC-0042')).toEqual({ text: 'FAC-0042', entityType: 'INVOICE' });
    expect(parseSearchQuery('  n:   reunión  ')).toEqual({ text: 'reunión', entityType: 'NOTE' });
    expect(parseSearchQuery('acme corp')).toEqual({ text: 'acme corp' });
    expect(parseSearchQuery('x: acme')).toEqual({ text: 'x: acme' });
    expect(parseSearchQuery('c:')).toEqual({ text: '', entityType: 'CLIENT' });
  });

  it('does not treat inherited object keys as prefixes', () => {
    expect(parseSearchQuery('toString: x')).toEqual({ text: 'toString: x' });
    expect(parseSearchQuery('_: x')).toEqual({ text: '_: x' });
  });
});

describe('search limits', () => {
  it('has nine searchable types and the 20 and 50 limits', () => {
    expect(SEARCHABLE_ENTITY_TYPE_VALUES).toHaveLength(9);
    expect(SEARCH_DEFAULT_LIMIT).toBe(20);
    expect(SEARCH_MAX_LIMIT).toBe(50);
  });

  it('searchLimit defaults to 20 and accepts 1 to 50', () => {
    expect(searchLimit(undefined)).toBe(20);
    expect(searchLimit(1)).toBe(1);
    expect(searchLimit(50)).toBe(50);
    for (const limit of [0, 51, 1.5, -1]) expect(() => searchLimit(limit), String(limit)).toThrow();
  });
});
