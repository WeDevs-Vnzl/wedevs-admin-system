import { randomUUID } from 'node:crypto';
import pg from 'pg';

/** Migrated and seeded once per run by `global-setup.ts`; every spec file clones it. */
export const TEMPLATE_DATABASE = 'core_template';

export interface SpecDatabase {
  /** Owner connection to the spec's own database; known before the database exists. */
  url: string;
  /** Clones the template into it. */
  create(): Promise<void>;
  drop(): Promise<void>;
}

/** `url` pointing at database `name`. */
export function withDatabase(url: string, name: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

/**
 * A database of its own for the calling spec file, cloned from the template (DT-117). Clones are created one
 * at a time: `CREATE DATABASE … TEMPLATE` fails while another session is connected to the template.
 */
export function specDatabase(serverUrl: string): SpecDatabase {
  const name = `spec_${randomUUID().replaceAll('-', '')}`;
  return {
    url: withDatabase(serverUrl, name),
    create: () =>
      asAdmin(serverUrl, async (admin) => {
        await admin.query('SELECT pg_advisory_lock(hashtext($1))', [TEMPLATE_DATABASE]);
        await admin.query(`CREATE DATABASE ${name} TEMPLATE ${TEMPLATE_DATABASE}`);
      }),
    drop: () =>
      asAdmin(serverUrl, async (admin) => {
        await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      }),
  };
}

export async function asAdmin(url: string, fn: (admin: pg.Client) => Promise<void>): Promise<void> {
  const admin = new pg.Client({ connectionString: url });
  await admin.connect();
  try {
    await fn(admin);
  } finally {
    // Ending the session also releases its advisory lock.
    await admin.end();
  }
}
