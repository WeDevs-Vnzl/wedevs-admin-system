import { describe, expect, it } from 'vitest';
import {
  GENERATE_ONLY_URL,
  generateOnlyFallback,
  isGenerateCommand,
} from '../../prisma/config-helpers';
import { assertLocalDatabaseUrl } from '../support/local-db-guard';

const argv = (...args: string[]) => ['node', '/x/prisma/build/index.js', ...args];

describe('assertLocalDatabaseUrl', () => {
  it('rejects pg host overrides in the query string', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://postgres:dev@localhost:5433/core?host=db.example.com'),
    ).toThrow(/host override/);
    expect(() =>
      assertLocalDatabaseUrl('postgresql://postgres:dev@localhost:5433/core?hostaddr=10.0.0.9'),
    ).toThrow(/host override/);
    expect(() =>
      assertLocalDatabaseUrl(
        'postgresql://postgres:dev@localhost:5433/core?sslmode=disable&host=x',
      ),
    ).toThrow(/host override/);
  });

  it('still accepts a local URL with unrelated parameters', () => {
    expect(() =>
      assertLocalDatabaseUrl('postgresql://postgres:dev@127.0.0.1:5433/core?sslmode=disable'),
    ).not.toThrow();
  });

  it('does not leak the URL in its errors', () => {
    expect(() => assertLocalDatabaseUrl('postgresql://u:secret@db.example.com/core')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('secret') }),
    );
  });
});

describe('prisma.config generate-only fallback', () => {
  it('applies to `prisma generate` with DIRECT_URL unset', () => {
    expect(isGenerateCommand(argv('generate'))).toBe(true);
    expect(generateOnlyFallback(argv('generate'), undefined)).toBe(GENERATE_ONLY_URL);
    expect(generateOnlyFallback(argv('generate', '--no-hints'), undefined)).toBe(GENERATE_ONLY_URL);
  });

  it('does not apply to `migrate dev --name generate` or other commands', () => {
    expect(
      generateOnlyFallback(argv('migrate', 'dev', '--name', 'generate'), undefined),
    ).toBeUndefined();
    expect(generateOnlyFallback(argv('migrate', 'deploy'), undefined)).toBeUndefined();
    expect(generateOnlyFallback(argv('db', 'seed'), undefined)).toBeUndefined();
  });

  it('never replaces a DIRECT_URL that is set', () => {
    expect(
      generateOnlyFallback(argv('generate'), 'postgresql://localhost:5433/core'),
    ).toBeUndefined();
  });
});
