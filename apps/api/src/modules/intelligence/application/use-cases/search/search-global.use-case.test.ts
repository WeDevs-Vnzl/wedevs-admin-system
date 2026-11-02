import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '../../../../../shared/domain/domain-error';
import { buildSearchWorld, hit, userOf } from '../../../../../../test/intelligence/search/world';
import { SearchGlobal } from './search-global.use-case';

function build() {
  const w = buildSearchWorld();
  return { ...w, search: new SearchGlobal(w.authorization, w.read) };
}

describe('SearchGlobal', () => {
  it('returns groups in the stable type order with each group total and omits empty groups', async () => {
    const { search, read } = build();
    read.result = {
      hits: [hit('INVOICE', 'i1'), hit('CLIENT', 'c1'), hit('CLIENT', 'c2')],
      totals: { CLIENT: 7, INVOICE: 1, NOTE: 4 },
    };
    const result = await search.execute(userOf('OWNER'), { q: 'kairos' });
    expect(result.query).toBe('kairos');
    expect(result.entityType).toBeNull();
    expect(result.groups.map((g) => [g.entityType, g.total, g.items.length])).toEqual([
      ['CLIENT', 7, 2],
      ['INVOICE', 1, 1],
    ]);
  });

  it('passes the default limit of 20 and a caller limit through the domain rule', async () => {
    const { search, read } = build();
    await search.execute(userOf('OWNER'), { q: 'a' });
    await search.execute(userOf('OWNER'), { q: 'a', limit: 3 });
    expect(read.searchCalls.map((call) => call.limit)).toEqual([20, 3]);
  });

  it.each([0, 51, 1.5])('rejects limit %s as VALIDATION without the DTO', async (limit) => {
    const { search } = build();
    await expect(search.execute(userOf('OWNER'), { q: 'a', limit })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it('rejects a query over 200 characters and unknown or empty entity types', async () => {
    const { search } = build();
    const owner = userOf('OWNER');
    await expect(search.execute(owner, { q: 'x'.repeat(201) })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(search.execute(owner, { q: 'x', entityTypes: ['USER'] })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
    await expect(search.execute(owner, { q: 'x', entityTypes: [] })).rejects.toBeInstanceOf(
      ValidationFailedError,
    );
  });

  it('returns nothing and does not read for a blank text, even behind a prefix', async () => {
    const { search, read } = build();
    const result = await search.execute(userOf('OWNER'), { q: 'c:   ' });
    expect(result).toEqual({ query: '', entityType: 'CLIENT', groups: [] });
    expect(read.exactCalls).toHaveLength(0);
    expect(read.searchCalls).toHaveLength(0);
  });

  describe('prefixes', () => {
    it.each([
      ['c: kairos', 'CLIENT'],
      ['p: kairos', 'PROJECT'],
      ['f: kairos', 'INVOICE'],
      ['d: kairos', 'DOCUMENT'],
      ['n: kairos', 'NOTE'],
    ] as const)('%s searches only %s', async (q, type) => {
      const { search, read } = build();
      const result = await search.execute(userOf('OWNER'), { q });
      expect(result.entityType).toBe(type);
      expect(result.query).toBe('kairos');
      expect(read.searchCalls[0]?.criteria.types).toEqual([type]);
    });

    it('wins over entityTypes, which otherwise narrows the search', async () => {
      const { search, read } = build();
      await search.execute(userOf('OWNER'), { q: 'c: a', entityTypes: ['PROJECT'] });
      await search.execute(userOf('OWNER'), { q: 'a', entityTypes: ['PROJECT', 'NOTE'] });
      expect(read.searchCalls.map((call) => call.criteria.types)).toEqual([
        ['CLIENT'],
        ['PROJECT', 'NOTE'],
      ]);
    });
  });

  describe('exact code (HU-26 CA3)', () => {
    it('answers that record alone and skips the ranked search', async () => {
      const { search, read } = build();
      read.exact = hit('INVOICE', 'inv1', { code: 'FAC-0003' });
      const result = await search.execute(userOf('OWNER'), { q: 'fac-0003' });
      expect(result.groups).toEqual([{ entityType: 'INVOICE', total: 1, items: [read.exact] }]);
      expect(read.searchCalls).toHaveLength(0);
    });
  });

  describe('visibility (C13, C14)', () => {
    it('asks the port only for the types the role may read', async () => {
      const { search, read } = build();
      await search.execute(userOf('MEMBER'), { q: 'kairos' });
      const types = read.searchCalls[0]?.criteria.types ?? [];
      expect(types).toContain('CLIENT');
      expect(types).not.toContain('INVOICE');
      expect(types).not.toContain('PAYMENT');
      expect(types).not.toContain('EXPENSE');
      expect(types).not.toContain('ACCOUNT');
    });

    it('a prefix for a type the role cannot read is empty, not an error, and reads nothing', async () => {
      const { search, read } = build();
      const result = await search.execute(userOf('MEMBER'), { q: 'f: FAC-0003' });
      expect(result).toEqual({ query: 'FAC-0003', entityType: 'INVOICE', groups: [] });
      expect(read.exactCalls).toHaveLength(0);
      expect(read.searchCalls).toHaveLength(0);
    });

    it('a Viewer with only financial types requested gets an empty answer', async () => {
      const { search, read } = build();
      const result = await search.execute(userOf('VIEWER'), {
        q: 'a',
        entityTypes: ['INVOICE', 'PAYMENT', 'EXPENSE', 'ACCOUNT'],
      });
      expect(result.groups).toEqual([]);
      expect(read.searchCalls).toHaveLength(0);
    });
  });

  describe('archived (HU-28 CA1, C19)', () => {
    it.each([
      ['OWNER', true, true],
      ['ADMIN', true, true],
      ['MEMBER', true, false],
      ['VIEWER', true, false],
      ['OWNER', false, false],
    ] as const)('%s with includeArchived=%s reaches the port as %s', async (role, asked, sent) => {
      const { search, read } = build();
      await search.execute(userOf(role), { q: 'veredas', includeArchived: asked });
      expect(read.searchCalls[0]?.criteria.includeArchived).toBe(sent);
      expect(read.exactCalls[0]?.includeArchived).toBe(sent);
    });
  });
});
