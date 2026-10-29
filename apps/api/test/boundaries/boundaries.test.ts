import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../..');
const FIXTURES = resolve(__dirname, 'fixtures');

interface Violation {
  /** Fixture directory under `violations/` holding one planted `bad.ts`. */
  readonly dir: string;
  /** Rule letter of `backend-architecture.md` §1/§9 and C11 (a)-(h). */
  readonly rule: string;
  readonly ruleId: string;
  /** Fragment expected in the reported message. */
  readonly message: string;
  readonly badFile: string;
}

const MODULES = 'src/modules/billing';
const violations: readonly Violation[] = [
  {
    dir: 'a-domain-imports-application',
    rule: 'a',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-domain',
    badFile: `${MODULES}/domain/bad.ts`,
  },
  {
    dir: 'a-domain-imports-nestjs',
    rule: 'a',
    ruleId: 'no-restricted-imports',
    message: 'Rule (a)',
    badFile: `${MODULES}/domain/bad.ts`,
  },
  {
    dir: 'b-application-imports-nestjs',
    rule: 'b',
    ruleId: 'no-restricted-imports',
    message: 'Rule (b)',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'b-application-imports-infrastructure',
    rule: 'b',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-application',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'c-infrastructure-imports-interface',
    rule: 'c',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-infrastructure',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'd-interface-imports-infrastructure',
    rule: 'd',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-interface',
    badFile: `${MODULES}/interface/bad.ts`,
  },
  {
    dir: 'e-cross-context-domain',
    rule: 'e',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-domain',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'e-cross-context-repository-port',
    rule: 'e',
    ruleId: 'boundaries/dependencies',
    message: 'repo-port',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'e-cross-context-infrastructure',
    rule: 'e',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-infrastructure',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'f-interface-imports-prisma',
    rule: 'f',
    ruleId: 'no-restricted-imports',
    message: 'Rule (f)',
    badFile: `${MODULES}/interface/bad.ts`,
  },
  {
    dir: 'f-application-imports-generated',
    rule: 'f',
    ruleId: 'no-restricted-imports',
    message: 'Rule (f)',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'g-application-reads-process-env',
    rule: 'g',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (g)',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'h-domain-date-now',
    rule: 'h',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (h)',
    badFile: `${MODULES}/domain/bad.ts`,
  },
  {
    dir: 'h-application-new-date',
    rule: 'h',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (h)',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'b-application-imports-sdk',
    rule: 'b',
    ruleId: 'no-restricted-imports',
    message: 'Rule (b)',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'b-application-imports-builtin',
    rule: 'b',
    ruleId: 'no-restricted-imports',
    message: 'Rule (b)',
    badFile: `${MODULES}/application/bad.ts`,
  },
  {
    dir: 'g-infrastructure-process-computed',
    rule: 'g',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (g)',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'g-infrastructure-globalthis-process',
    rule: 'g',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (g)',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'g-infrastructure-destructure-process',
    rule: 'g',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (g)',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'g-infrastructure-imports-node-process',
    rule: 'g',
    ruleId: 'no-restricted-imports',
    message: 'Rule (g)',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'g-infrastructure-imports-process',
    rule: 'g',
    ruleId: 'no-restricted-imports',
    message: 'Rule (g)',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'h-domain-date-call',
    rule: 'h',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (h)',
    badFile: `${MODULES}/domain/bad.ts`,
  },
  {
    dir: 'h-domain-globalthis-date-now',
    rule: 'h',
    ruleId: 'no-restricted-syntax',
    message: 'Rule (h)',
    badFile: `${MODULES}/domain/bad.ts`,
  },
  {
    dir: 'a-domain-cross-context-domain',
    rule: 'a',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-domain',
    badFile: `${MODULES}/domain/bad.ts`,
  },
  {
    dir: 'e-infrastructure-cross-context-repository-port',
    rule: 'e',
    ruleId: 'boundaries/dependencies',
    message: 'repo-port',
    badFile: `${MODULES}/infrastructure/bad.ts`,
  },
  {
    dir: 'd-interface-imports-own-domain',
    rule: 'd',
    ruleId: 'boundaries/dependencies',
    message: 'ctx-domain',
    badFile: `${MODULES}/interface/bad.ts`,
  },
  {
    dir: 'a-shared-domain-imports-shared-infrastructure',
    rule: 'a',
    ruleId: 'boundaries/dependencies',
    message: 'shared-domain',
    badFile: 'src/shared/domain/bad.ts',
  },
];

// Real ESLint runs: the first lint also loads the config and the type-aware parser, which exceeds the
// 5 s default when the whole monorepo test run shares the machine.
describe('hexagonal boundary lint', { timeout: 30_000 }, () => {
  let eslint: ESLint;

  beforeAll(() => {
    // `ignore: false` lints the fixtures that the project config excludes from `bun run lint`.
    eslint = new ESLint({
      cwd: ROOT,
      overrideConfigFile: resolve(ROOT, 'eslint.config.mjs'),
      ignore: false,
    });
  });

  async function lint(dir: string) {
    const results = await eslint.lintFiles([`${FIXTURES}/${dir}/**/*.ts`]);
    return results.map((result) => ({
      file: result.filePath.slice(`${FIXTURES}/${dir}/`.length),
      messages: result.messages,
    }));
  }

  it('covers every rule (a) to (h)', () => {
    const letters = new Set(violations.map((violation) => violation.rule));
    expect([...letters].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  describe.each(violations)('planted violation $dir', (violation) => {
    it(`reports rule (${violation.rule}) as ${violation.ruleId}`, async () => {
      const results = await lint(`violations/${violation.dir}`);
      const bad = results.find((result) => result.file === violation.badFile);
      expect(bad, `missing ${violation.badFile}`).toBeDefined();
      const hit = bad?.messages.filter(
        (message) =>
          message.ruleId === violation.ruleId && message.message.includes(violation.message),
      );
      expect(hit?.length, JSON.stringify(bad?.messages)).toBeGreaterThan(0);
      const others = results.filter((result) => result.file !== violation.badFile);
      expect(others.flatMap((result) => result.messages)).toEqual([]);
    });
  });

  it('reports zero problems on the clean set', async () => {
    const results = await lint('clean');
    expect(results.length).toBeGreaterThan(5);
    const messages = results.flatMap((result) =>
      result.messages.map((message) => `${result.file}: ${message.ruleId} ${message.message}`),
    );
    expect(messages).toEqual([]);
  });
});
