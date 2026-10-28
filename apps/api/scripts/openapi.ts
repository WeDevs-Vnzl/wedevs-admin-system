import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { buildOpenApiDocument, configureApp } from '../src/app.setup';
import { parseEnv } from '../src/config/env.schema';

const OUTPUT = resolve(__dirname, '..', 'openapi.json');

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortKeys(record[key])]),
    );
  }
  return value;
}

/** Builds the app without listening and without a database (the pool connects lazily). */
async function render(): Promise<string> {
  process.env.NODE_ENV ??= 'test';
  process.env.APP_URL ??= 'http://localhost:3001';
  process.env.DATABASE_URL ??= 'postgresql://postgres:dev@localhost:5432/core';
  // Documented placeholders, set inside this process only: the document needs no real credential.
  process.env.CLERK_SECRET_KEY ??= 'sk_test_openapi_placeholder';
  process.env.CLERK_PUBLISHABLE_KEY ??= 'pk_test_openapi_placeholder';
  process.env.CLERK_JWT_KEY ??= 'openapi-placeholder-jwt-key';
  process.env.CLERK_WEBHOOK_SECRET ??= 'whsec_b3BlbmFwaS1wbGFjZWhvbGRlcg==';
  process.env.CLOUDINARY_CLOUD_NAME ??= 'openapi-placeholder';
  process.env.CLOUDINARY_API_KEY ??= 'openapi-placeholder';
  process.env.CLOUDINARY_API_SECRET ??= 'openapi-placeholder';
  const config = { ...parseEnv(process.env), SENTRY_DSN: undefined, NODE_ENV: 'test' as const };
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  try {
    configureApp(app, config);
    return `${JSON.stringify(sortKeys(buildOpenApiDocument(app)), null, 2)}\n`;
  } finally {
    await app.close();
  }
}

function summarize(expected: string, actual: string): string {
  const a = expected.split('\n');
  const b = actual.split('\n');
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max && lines.length < 20; i++) {
    if (a[i] !== b[i])
      lines.push(
        `line ${i + 1}:\n  committed: ${a[i] ?? '<none>'}\n  generated: ${b[i] ?? '<none>'}`,
      );
  }
  return lines.join('\n');
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const fresh = await render();
  if (mode === 'generate') {
    writeFileSync(OUTPUT, fresh);
    console.log('openapi.json written');
    return;
  }
  if (mode === 'check') {
    let committed = '';
    try {
      committed = readFileSync(OUTPUT, 'utf8');
    } catch {
      /* missing file counts as drift */
    }
    if (committed === fresh) {
      console.log('openapi.json is up to date');
      return;
    }
    console.error('openapi.json is stale. Run `bun run openapi:generate` and commit it.');
    console.error(summarize(committed, fresh));
    process.exitCode = 1;
    return;
  }
  console.error('usage: tsx scripts/openapi.ts generate|check');
  process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'openapi script failed');
  process.exit(1);
});
