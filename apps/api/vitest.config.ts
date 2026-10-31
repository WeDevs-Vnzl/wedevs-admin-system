import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// `int` and `e2e` start their own PostgreSQL (Testcontainers): Docker or the podman socket is required. One
// server per project run, one database per spec file cloned from a migrated and seeded template (DT-117).
const withDatabase = {
  globalSetup: ['./test/support/global-setup.ts'],
  setupFiles: ['./test/support/spec-database.ts'],
  hookTimeout: 120_000,
};

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2023',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: false,
    environment: 'node',
    // Leaves CPU for the other turbo tasks (build, lint, web tests) running alongside.
    maxWorkers: '50%',
    // With --changed (`test:int:affected`, `test:e2e:affected`), a diff touching any of these runs every spec:
    // the import graph does not see SQL, the seed, config, dependencies or the kernel the specs share.
    forceRerunTriggers: [
      '**/package.json/**',
      '**/bun.lock/**',
      '**/turbo.json/**',
      '**/vitest.config.*/**',
      '**/tsconfig*.json/**',
      '**/compose.yaml/**',
      '**/apps/api/prisma.config.ts/**',
      '**/apps/api/prisma/**',
      '**/apps/api/src/shared/**',
      '**/apps/api/src/config/**',
      '**/apps/api/test/support/**',
      '**/apps/api/test/db/helpers.ts/**',
      '**/packages/api-contract/**',
    ],
    coverage: {
      provider: 'v8',
      // Money and business-date today; the finance globs start enforcing when package 1.3 and the use
      // cases add files. Vitest 5 builds the per-glob threshold from the files that match it, and a glob
      // with no matching file is skipped silently (checked in the 1.2 report), so the gate cannot fail
      // before the files exist and cannot be skipped once they do.
      include: [
        'src/shared/domain/money.ts',
        'src/shared/domain/business-date.ts',
        'src/modules/finance/domain/**/*.ts',
        'src/modules/finance/application/use-cases/{invoices,payments,accounts,billing}/**/*.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.int.test.ts', '**/*.e2e-spec.ts'],
      thresholds: {
        'src/shared/domain/money.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/shared/domain/business-date.ts': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
        'src/modules/finance/domain/**': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/modules/finance/application/use-cases/{invoices,payments,accounts,billing}/**': {
          lines: 90,
          functions: 90,
          branches: 90,
          statements: 90,
        },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: ['**/*.int.test.ts', 'test/boundaries/fixtures/**', 'node_modules/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'int',
          include: ['**/*.int.test.ts'],
          exclude: ['node_modules/**'],
          ...withDatabase,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          ...withDatabase,
        },
      },
    ],
  },
});
