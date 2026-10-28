import { describe, expect, it } from 'vitest';
import { FileAccessRegistry } from './file-access.registry';
import type { FileAccessClaim, FileAccessResolver } from './ports/file-access.port';

const resolverOf = (claim: FileAccessClaim | null): FileAccessResolver => ({
  resolve: () => Promise.resolve(claim),
});

describe('FileAccessRegistry', () => {
  it('has no claims when nothing is registered or nobody owns the file', async () => {
    const registry = new FileAccessRegistry();
    expect(await registry.claimsFor('f1')).toEqual([]);
    registry.register(resolverOf(null));
    expect(await registry.claimsFor('f1')).toEqual([]);
  });

  it('collects the claims of every resolver in registration order', async () => {
    const registry = new FileAccessRegistry();
    registry.register(resolverOf({ kind: 'authenticated' }));
    registry.register(resolverOf(null));
    registry.register(resolverOf({ kind: 'resource', resource: 'invoice' }));
    expect(await registry.claimsFor('f1')).toEqual([
      { kind: 'authenticated' },
      { kind: 'resource', resource: 'invoice' },
    ]);
  });

  it('ignores a resolver registered twice', async () => {
    const registry = new FileAccessRegistry();
    const resolver = resolverOf({ kind: 'authenticated' });
    registry.register(resolver);
    registry.register(resolver);
    expect(await registry.claimsFor('f1')).toHaveLength(1);
  });
});
