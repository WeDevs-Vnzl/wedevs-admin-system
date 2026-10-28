import { describe, expect, it } from 'vitest';
import { FakeTaggableTargetResolver } from '../../../../test/settings/tags/fakes';
import { TaggableTargetRegistry } from './taggable-target.registry';

describe('TaggableTargetRegistry', () => {
  it('returns the resolver registered for an entity type', () => {
    const registry = new TaggableTargetRegistry();
    const clients = new FakeTaggableTargetResolver('CLIENT', 'client');
    registry.register(clients);
    expect(registry.has('CLIENT')).toBe(true);
    expect(registry.resolverFor('CLIENT')).toBe(clients);
  });

  it('answers VALIDATION on entityType for an unregistered type (INVOICE until BE-3)', () => {
    const registry = new TaggableTargetRegistry();
    for (const type of ['INVOICE', 'NOT_A_TYPE']) {
      expect(registry.has(type)).toBe(false);
      expect(() => registry.resolverFor(type)).toThrowError(
        expect.objectContaining({
          code: 'VALIDATION',
          fieldErrors: { entityType: ['validation.invalidOption'] },
        }),
      );
    }
  });

  it('replaces the resolver when the same type registers again', () => {
    const registry = new TaggableTargetRegistry();
    const first = new FakeTaggableTargetResolver('NOTE', 'note');
    const second = new FakeTaggableTargetResolver('NOTE', 'note');
    registry.register(first);
    registry.register(second);
    expect(registry.resolverFor('NOTE')).toBe(second);
  });
});
