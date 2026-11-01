import { describe, expect, it } from 'vitest';
import { ExportSourceRegistry, type ExportSource } from './export-source.port';

const source = (entity: string): ExportSource<{ name: string }> => ({
  entity,
  columns: { name: { type: 'text', value: (row) => row.name } },
  read: async () => ({ rows: [{ name: 'Acme' }], total: 1 }),
});

describe('ExportSourceRegistry', () => {
  it('returns the registered source and lists the entities', () => {
    const registry = new ExportSourceRegistry();
    const clients = source('clients');
    registry.register(clients);
    registry.register(source('projects'));
    expect(registry.get('clients')).toBe(clients);
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.entities()).toEqual(['clients', 'projects']);
  });

  it('throws on a duplicate entity and keeps the first source', () => {
    const registry = new ExportSourceRegistry();
    const first = source('clients');
    registry.register(first);
    expect(() => registry.register(source('clients'))).toThrow(/clients/);
    expect(registry.get('clients')).toBe(first);
  });
});
