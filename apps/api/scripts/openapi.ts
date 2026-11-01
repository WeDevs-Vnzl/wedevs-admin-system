import 'reflect-metadata';
import { readFileSync, writeFileSync } from 'node:fs';
import Module from 'node:module';
import { resolve, sep } from 'node:path';
import { transformSync } from '@swc/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

// tsx (esbuild) does not emit `design:paramtypes`, so @nestjs/swagger could not describe `@Param`, `@Query` and
// `@Body` DTOs. The app sources are compiled with swc and decorator metadata instead, the same transform the
// vitest projects use, so the document is generated from the metadata `nest build` (tsc) ships.
const SRC = resolve(__dirname, '..', 'src') + sep;
type Extension = (module: NodeJS.Module, filename: string) => void;
const extensions = (Module as unknown as { _extensions: Record<string, Extension> })._extensions;
const defaultTs = extensions['.ts'] as Extension;
extensions['.ts'] = (module, filename) => {
  if (!filename.startsWith(SRC)) return defaultTs(module, filename);
  const { code } = transformSync(readFileSync(filename, 'utf8'), {
    filename,
    sourceMaps: 'inline',
    module: { type: 'commonjs' },
    jsc: {
      target: 'es2023',
      parser: { syntax: 'typescript', decorators: true },
      transform: { legacyDecorator: true, decoratorMetadata: true },
    },
  });
  (module as unknown as { _compile(code: string, filename: string): void })._compile(
    code,
    filename,
  );
};

// The contract lives in its own workspace package so apps/web reads it without copying (DT-115).
const OUTPUT = resolve(__dirname, '..', '..', '..', 'packages', 'api-contract', 'openapi.json');

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
  process.env.SHARE_IP_SALT ??= 'openapi-placeholder-share-ip-salt-000000';
  process.env.SHARE_UNLOCK_SECRET ??= 'openapi-placeholder-share-unlock-secret-00';
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../src/app.module.js');
  const { buildOpenApiDocument, configureApp } = await import('../src/app.setup.js');
  const { parseEnv } = await import('../src/config/env.schema.js');
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
    console.log('packages/api-contract/openapi.json written');
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
      console.log('packages/api-contract/openapi.json is up to date');
      return;
    }
    console.error(
      'packages/api-contract/openapi.json is stale. Run `bun run openapi:generate` and commit it.',
    );
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
