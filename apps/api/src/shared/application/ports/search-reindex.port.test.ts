import { describe, expect, it } from 'vitest';
import { SearchReindexRegistry, type SearchReindexSource } from './search-reindex.port';

const source = (entityType: SearchReindexSource['entityType']): SearchReindexSource => ({
  entityType,
  pageIds: async () => [],
  entryOf: async () => null,
});

describe('SearchReindexRegistry', () => {
  it('returns the registered source and lists the types in registration order', () => {
    const registry = new SearchReindexRegistry();
    const client = source('CLIENT');
    registry.register(client);
    registry.register(source('PROJECT'));
    expect(registry.get('CLIENT')).toBe(client);
    expect(registry.get('INVOICE')).toBeUndefined();
    expect(registry.types()).toEqual(['CLIENT', 'PROJECT']);
  });

  it('throws on a duplicate type and keeps the first source', () => {
    const registry = new SearchReindexRegistry();
    const first = source('CLIENT');
    registry.register(first);
    expect(() => registry.register(source('CLIENT'))).toThrow(/CLIENT/);
    expect(registry.get('CLIENT')).toBe(first);
  });
});
