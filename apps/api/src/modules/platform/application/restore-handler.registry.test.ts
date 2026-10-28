import { describe, expect, it } from 'vitest';
import { FakeRestoreHandler } from '../../../../test/trash/harness';
import { RestoreHandlerRegistry } from './restore-handler.registry';

describe('RestoreHandlerRegistry', () => {
  it('looks handlers up by entity type and lists them in registration order', () => {
    const registry = new RestoreHandlerRegistry();
    const client = new FakeRestoreHandler('CLIENT', 'client');
    const note = new FakeRestoreHandler('NOTE', 'note');
    registry.register(client);
    registry.register(note);
    expect(registry.get('CLIENT')).toBe(client);
    expect(registry.get('NOTE')).toBe(note);
    expect(registry.get('PROJECT')).toBeUndefined();
    expect(registry.get('nope')).toBeUndefined();
    expect(registry.all()).toEqual([client, note]);
  });

  it('registering the same handler twice is a no-op', () => {
    const registry = new RestoreHandlerRegistry();
    const client = new FakeRestoreHandler('CLIENT', 'client');
    registry.register(client);
    registry.register(client);
    expect(registry.all()).toHaveLength(1);
  });

  it('refuses a second, different handler for the same type', () => {
    const registry = new RestoreHandlerRegistry();
    registry.register(new FakeRestoreHandler('CLIENT', 'client'));
    expect(() => registry.register(new FakeRestoreHandler('CLIENT', 'client'))).toThrow(
      /already registered for CLIENT/,
    );
  });
});
