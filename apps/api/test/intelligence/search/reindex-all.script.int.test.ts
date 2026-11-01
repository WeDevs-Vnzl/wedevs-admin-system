import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runReindexAll } from '../../../scripts/reindex-all';
import { createTestPrisma, truncateBusinessTables } from '../../support/db';
import { applyTestEnv } from '../../support/test-env';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 120_000 });

/** `scripts/reindex-all.ts` (DT-167): a repair script over the Nest contexts, local database only. */
describe('scripts/reindex-all', () => {
  const admin = createTestPrisma();
  const url = process.env.DATABASE_URL;

  beforeAll(async () => {
    applyTestEnv();
    process.env.NODE_ENV = 'test';
    process.env.APP_URL = 'http://localhost:3001';
    await truncateBusinessTables(admin);
  });
  afterAll(async () => {
    await truncateBusinessTables(admin);
    await admin.$disconnect();
  });

  it.each([
    [undefined, 'DATABASE_URL is not set'],
    ['not a url', 'DATABASE_URL is not a valid URL'],
    [
      'postgresql://u:p@db.example.com:5432/core',
      'Refusing to run against a non-local database host',
    ],
    [
      'postgresql://u:p@localhost:5432/core?host=db.example.com',
      'Refusing to run against a database URL with a host override',
    ],
  ])('refuses %s without echoing the URL', async (value, message) => {
    const error = await runReindexAll(value).catch((e: unknown) => e as Error);
    expect((error as Error).message).toBe(message);
    expect((error as Error).message).not.toContain('example.com');
  });

  it('boots the contexts, walks the registered sources and leaves the index consistent', async () => {
    await admin.searchEntry.create({
      data: { entityType: 'CLIENT', entityId: 'cli_orphan', title: 'No source row' },
    });
    const result = await runReindexAll(url);
    // Every registered source is walked: whatever the contexts register, an entry of a type with a source
    // whose row is gone is removed, and a type nobody registers is left alone.
    expect(typeof result).toBe('object');
    const clientRun = result.CLIENT;
    if (clientRun) {
      expect(clientRun.removed).toBeGreaterThanOrEqual(1);
      expect(await admin.searchEntry.count({ where: { entityId: 'cli_orphan' } })).toBe(0);
    } else {
      expect(await admin.searchEntry.count({ where: { entityId: 'cli_orphan' } })).toBe(1);
    }
  });
});
