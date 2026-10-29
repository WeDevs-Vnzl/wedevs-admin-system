import { afterAll, beforeAll, inject } from 'vitest';
import { specDatabase } from './test-database';

// setupFiles entry of the `int` and `e2e` projects (DT-117). It runs before each spec file's own imports, so
// specs that read `DATABASE_URL` at module load already see their own database. Specs are CommonJS (no
// top-level await) and only connect inside hooks, so the clone can be created in the first beforeAll.
const database = specDatabase(inject('postgresUrl'));
process.env.DATABASE_URL = database.url;
process.env.DIRECT_URL = database.url;

// Registered before the spec's hooks: created first, dropped last (sequence.hooks 'stack').
beforeAll(() => database.create());
afterAll(() => database.drop());
