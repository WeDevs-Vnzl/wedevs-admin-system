import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { generateOnlyFallback } from './prisma/config-helpers';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: {
    // Direct connection (no pooler) for Migrate. `prisma generate` never connects, so it alone may run
    // without DIRECT_URL (fresh clone, CI, Docker; IOU-08). Every other command still requires it.
    url: generateOnlyFallback(process.argv, process.env.DIRECT_URL) ?? env('DIRECT_URL'),
    // Optional: only needed by `prisma migrate diff --from-migrations` (drift procedure, README.md).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
