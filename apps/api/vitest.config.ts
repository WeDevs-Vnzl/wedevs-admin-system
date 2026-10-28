import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

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
    coverage: {
      provider: 'v8',
      include: ['src/shared/domain/money.ts', 'src/shared/domain/business-date.ts'],
      thresholds: {
        'src/shared/domain/money.ts': { lines: 90, functions: 90, branches: 90, statements: 90 },
        'src/shared/domain/business-date.ts': {
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
          fileParallelism: false,
        },
      },
      {
        extends: true,
        test: {
          name: 'e2e',
          include: ['test/**/*.e2e-spec.ts'],
          fileParallelism: false,
        },
      },
    ],
  },
});
