import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import {
  ReindexAll,
  type ReindexAllResult,
} from '../src/modules/intelligence/application/use-cases/search/reindex-all.use-case';
import { SearchModule } from '../src/modules/intelligence/search.module';
import { SYSTEM_ACTOR } from '../src/shared/application/actor';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/** Local database only (safeguards), the same guard as `recompute-all.ts`: the URL is never printed. */
function assertLocalDatabase(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (['host', 'hostaddr', 'service'].some((key) => parsed.searchParams.has(key))) {
    throw new Error('Refusing to run against a database URL with a host override');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('Refusing to run against a non-local database host');
  }
  return url;
}

/**
 * The application's own contexts plus the search module. Sources register in each context's `onModuleInit`
 * (`SearchReindexRegistry`), so booting the contexts is what wires them: nothing is registered by hand here.
 */
@Module({ imports: [AppModule, SearchModule] })
class ReindexScriptModule {}

/**
 * Rebuilds every `SearchEntry` through `ReindexAll` as the `SYSTEM` actor (DT-167): a repair, with no route
 * and no schedule. A Nest application context, not a server. Local database only.
 */
export async function runReindexAll(databaseUrl: string | undefined): Promise<ReindexAllResult> {
  process.env.DATABASE_URL = assertLocalDatabase(databaseUrl);
  const app = await NestFactory.createApplicationContext(ReindexScriptModule, { logger: false });
  try {
    return await app.get(ReindexAll).execute(SYSTEM_ACTOR);
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  runReindexAll(process.env.DATABASE_URL).then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
    },
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    },
  );
}
