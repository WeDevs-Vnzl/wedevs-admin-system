import { describe, expect, it } from 'vitest';
import { createWorld, seedUser, type World } from '../../../../../test/identity/world';
import { GetPreferences } from './get-preferences.use-case';
import { ResetPreference } from './reset-preference.use-case';
import { SetPreference } from './set-preference.use-case';

const columns = { order: ['name', 'status'], visibility: { status: false }, widths: { name: 240 } };

function build(world: World) {
  return {
    get: new GetPreferences(world.users, world.preferences),
    set: new SetPreference(world.users, world.preferences),
    reset: new ResetPreference(world.users, world.preferences),
  };
}

describe('GetPreferences', () => {
  it('falls back to the user row, then to the defaults', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER', { locale: 'en', theme: 'dark' });
    expect(await build(world).get.execute(actor)).toEqual({
      locale: 'en',
      theme: 'dark',
      timezone: 'America/Caracas',
      tableColumns: {},
    });
  });

  it('ignores a stored row that no longer parses', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    world.preferences.rows.push(
      { userId: actor.userId, key: 'theme', value: 'neon' },
      { userId: actor.userId, key: 'table:clients:columns', value: 'nope' },
    );
    const prefs = await build(world).get.execute(actor);
    expect(prefs.theme).toBe('system');
    expect(prefs.tableColumns).toEqual({});
  });
});

describe('SetPreference', () => {
  it('stores theme, timezone and locale and returns all preferences', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    const { set } = build(world);
    await set.execute(actor, { key: 'theme', value: 'dark' });
    await set.execute(actor, { key: 'timezone', value: 'America/Bogota' });
    const result = await set.execute(actor, { key: 'locale', value: 'en' });
    expect(result).toMatchObject({ theme: 'dark', timezone: 'America/Bogota', locale: 'en' });
  });

  it('stores the column layout of a table under table:<id>:columns', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    const result = await build(world).set.execute(actor, {
      key: 'table:clients:columns',
      value: columns,
    });
    expect(result.tableColumns).toEqual({ clients: columns });
    expect(world.preferences.rows).toEqual([
      { userId: actor.userId, key: 'table:clients:columns', value: columns },
    ]);
  });

  it('replaces a previous value instead of adding a second row', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    const { set, get } = build(world);
    await set.execute(actor, { key: 'theme', value: 'dark' });
    await set.execute(actor, { key: 'theme', value: 'light' });
    expect(world.preferences.rows.filter((row) => row.key === 'theme')).toHaveLength(1);
    expect((await get.execute(actor)).theme).toBe('light');
  });

  it('copies the value, so a later mutation by the caller does not reach the store', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    const mine = structuredClone(columns);
    const { set, get } = build(world);
    await set.execute(actor, { key: 'table:clients:columns', value: mine });
    mine.order.push('extra');
    expect((await get.execute(actor)).tableColumns.clients?.order).toEqual(['name', 'status']);
  });

  it('only ever touches the acting user’s own rows', async () => {
    const world = createWorld();
    const a = seedUser(world, 'OWNER');
    seedUser(world, 'ADMIN');
    world.preferences.rows.push({ userId: 'usr_admin', key: 'theme', value: 'dark' });
    const { set, get } = build(world);
    expect((await get.execute(a.actor)).theme).toBe('system');
    await set.execute(a.actor, { key: 'theme', value: 'light' });
    expect(world.preferences.rows.find((row) => row.userId === 'usr_admin')?.value).toBe('dark');
  });

  it('rejects an invalid value or key with field errors and stores nothing', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    const { set } = build(world);
    await expect(set.execute(actor, { key: 'locale', value: 'fr' })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { value: ['validation.invalidOption'] },
    });
    await expect(set.execute(actor, { key: 'unknown', value: 'x' })).rejects.toMatchObject({
      code: 'VALIDATION',
      fieldErrors: { key: ['validation.invalidFormat'] },
    });
    expect(world.preferences.rows).toHaveLength(0);
  });
});

describe('ResetPreference', () => {
  it('removes the key so its default applies again', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    const { set, reset } = build(world);
    await set.execute(actor, { key: 'table:clients:columns', value: columns });
    await set.execute(actor, { key: 'theme', value: 'dark' });
    const result = await reset.execute(actor, { key: 'table:clients:columns' });
    expect(result.tableColumns).toEqual({});
    expect(result.theme).toBe('dark');
    expect(world.preferences.rows).toHaveLength(1);
  });

  it('is a no-op for a key never stored and keeps other users’ rows; an invalid key is VALIDATION', async () => {
    const world = createWorld();
    const { actor } = seedUser(world, 'OWNER');
    world.preferences.rows.push({ userId: 'usr_b', key: 'theme', value: 'dark' });
    const { reset } = build(world);
    await reset.execute(actor, { key: 'theme' });
    expect(world.preferences.rows).toHaveLength(1);
    await expect(reset.execute(actor, { key: 'nope' })).rejects.toMatchObject({
      code: 'VALIDATION',
    });
  });
});
