import js from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

// Layer boundary rules: docs/rules/backend-architecture.md §1/§9, conventions C11.
// Patterns start with `**/` so the planted-violation fixtures under
// test/boundaries/fixtures/** (which mirror the src/ layout) are classified the same way.
const SRC = '**/src';

// Folder-level elements. `**` is the first wildcard of every pattern, so it is captured as
// `root` and the bounded context is the second capture.
const el = (type, pattern, capture = ['root']) => ({
  type,
  pattern,
  partialMatch: false,
  capture,
});
const ctxEl = (type, layer) => el(type, `${SRC}/modules/*/${layer}`, ['root', 'context']);

const elements = [
  ctxEl('ctx-domain', 'domain'),
  ctxEl('ctx-application', 'application'),
  ctxEl('ctx-infrastructure', 'infrastructure'),
  ctxEl('ctx-interface', 'interface'),
  el('shared-domain', `${SRC}/shared/domain`),
  el('shared-application', `${SRC}/shared/application`),
  el('shared-infrastructure', `${SRC}/shared/infrastructure`),
  el('shared-interface', `${SRC}/shared/interface`),
  el('config', `${SRC}/config`),
];

const files = [
  { category: 'repo-port', pattern: `${SRC}/modules/*/application/ports/*.repository.port.ts` },
  { category: 'plain', pattern: '**/*.ts' },
];

const sameCtx = (type) => ({
  element: { type, captured: { context: '{{ from.element.captured.context }}' } },
});
const anyOf = (...types) => ({ element: { types: { anyOf: types } } });
// (e) another context is reachable only through its application layer, never its repository ports
const otherCtxApplication = {
  element: { type: 'ctx-application' },
  file: { categories: 'plain' },
};
const allow = (fromType, ...to) => ({ from: { element: { type: fromType } }, allow: { to } });

const policies = [
  // Third-party and Node modules are policed per layer by no-restricted-imports below.
  { allow: { to: { module: { origin: ['external', 'core'] } } } },
  // (a) domain -> own domain, shared/domain
  allow('ctx-domain', sameCtx('ctx-domain'), anyOf('shared-domain')),
  // (b) application -> domain, shared/domain, shared/application
  allow(
    'ctx-application',
    sameCtx('ctx-domain'),
    sameCtx('ctx-application'),
    anyOf('shared-domain', 'shared-application'),
    otherCtxApplication,
  ),
  // (c) infrastructure -> never interface
  allow(
    'ctx-infrastructure',
    sameCtx('ctx-domain'),
    sameCtx('ctx-application'),
    sameCtx('ctx-infrastructure'),
    anyOf('shared-domain', 'shared-application', 'shared-infrastructure', 'config'),
    otherCtxApplication,
  ),
  // (d) interface -> never infrastructure
  allow(
    'ctx-interface',
    sameCtx('ctx-application'),
    sameCtx('ctx-interface'),
    anyOf('shared-domain', 'shared-application', 'shared-interface', 'config'),
    otherCtxApplication,
  ),
  allow('shared-domain', anyOf('shared-domain')),
  allow('shared-application', anyOf('shared-domain', 'shared-application')),
  allow(
    'shared-infrastructure',
    anyOf('shared-domain', 'shared-application', 'shared-infrastructure', 'config'),
  ),
  allow(
    'shared-interface',
    anyOf('shared-domain', 'shared-application', 'shared-interface', 'config'),
  ),
  allow('config', anyOf('config')),
];

const TESTS = ['**/*.test.ts', '**/*.int.test.ts', '**/*.e2e-spec.ts'];
const LAYER_FILES = [
  `${SRC}/modules/*/{domain,application,infrastructure,interface}/**/*.ts`,
  `${SRC}/shared/**/*.ts`,
  `${SRC}/config/**/*.ts`,
];

// (f) the Prisma client and the generated client live only in infrastructure adapters
const prismaGroup = {
  group: ['@prisma/*', '**/generated', '**/generated/**'],
  message: 'Rule (f): @prisma/* and src/generated/** are allowed only in infrastructure adapters.',
};
// (a)/(b) allowlist: domain and application import no bare specifier except decimal.js
const bareSpecifierGroup = (rule, layer) => ({
  regex: '^(?!decimal\\.js$)[^./]',
  message: `Rule (${rule}): ${layer} imports only relative paths and decimal.js (no SDKs, frameworks or Node builtins).`,
});
// (g) process is reachable only from src/config
const processGroup = {
  group: ['process', 'node:process'],
  message: 'Rule (g): importing process is allowed only in src/config.',
};
// (i)-(k) provider SDKs live only in their adapter folder (C11, BE-6): `stripe` in
// integrations/infrastructure/stripe, the Binance connector in integrations/infrastructure/binance, the MCP SDK in
// modules/mcp/interface/mcp. The carve-out blocks at the end of this file drop one group each.
const stripeGroup = {
  group: ['stripe', 'stripe/**'],
  message:
    'Rule (i): stripe is allowed only in src/modules/integrations/infrastructure/stripe/ (an SDK type never crosses a port).',
};
const binanceGroup = {
  group: ['@binance/*', 'binance', 'binance/**', 'binance-api-node', 'node-binance-api'],
  message:
    'Rule (j): the Binance connector is allowed only in src/modules/integrations/infrastructure/binance/.',
};
const mcpGroup = {
  group: ['@modelcontextprotocol/*'],
  message: 'Rule (k): @modelcontextprotocol/sdk is allowed only in src/modules/mcp/interface/mcp/.',
};
const sdkGroups = [stripeGroup, binanceGroup, mcpGroup];
const restrictImports = (...patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

const G = "[object.name='globalThis']";
const processEnv = [
  {
    selector: "MemberExpression[object.name='process'][property.name='env']",
    message:
      'Rule (g): process.env is read only in src/config, prisma.config.ts, prisma, scripts and tests.',
  },
  {
    selector: "MemberExpression[object.name='process'][computed=true][property.value='env']",
    message: 'Rule (g): process.env is read only in src/config (computed access).',
  },
  {
    selector: `MemberExpression${G}[property.name='process']`,
    message: 'Rule (g): globalThis.process is forbidden outside src/config.',
  },
  {
    selector: "VariableDeclarator[init.name='process'][id.type='ObjectPattern']",
    message: 'Rule (g): destructuring process is forbidden outside src/config.',
  },
  {
    selector: "AssignmentExpression[right.name='process'][left.type='ObjectPattern']",
    message: 'Rule (g): destructuring process is forbidden outside src/config.',
  },
];
const clock = [
  {
    selector: "CallExpression[callee.object.name='Date'][callee.property.name='now']",
    message: 'Rule (h): Date.now() is forbidden in domain/application; use ClockPort.',
  },
  {
    selector:
      "CallExpression[callee.object.object.name='globalThis'][callee.object.property.name='Date'][callee.property.name='now']",
    message: 'Rule (h): globalThis.Date.now() is forbidden in domain/application; use ClockPort.',
  },
  {
    selector: "NewExpression[callee.name='Date'][arguments.length=0]",
    message:
      'Rule (h): new Date() without arguments is forbidden in domain/application; use ClockPort.',
  },
  {
    selector:
      "NewExpression[callee.object.name='globalThis'][callee.property.name='Date'][arguments.length=0]",
    message: 'Rule (h): new globalThis.Date() is forbidden in domain/application; use ClockPort.',
  },
  {
    selector: "CallExpression[callee.name='Date']",
    message: 'Rule (h): Date() without new is forbidden in domain/application; use ClockPort.',
  },
];

export default tseslint.config(
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'src/generated/**',
      'test/boundaries/fixtures/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
    },
  },
  {
    files: LAYER_FILES,
    ignores: TESTS,
    plugins: { boundaries },
    settings: {
      'boundaries/elements': elements,
      'boundaries/files': files,
      'boundaries/elements-single-match': true,
      'boundaries/files-single-match': true,
      'import/resolver': { node: { extensions: ['.ts', '.js', '.json'] } },
    },
    rules: {
      'boundaries/dependencies': [2, { default: 'disallow', policies }],
    },
  },
  // (f) + (g): Prisma only in infrastructure, process only in config
  {
    files: [`${SRC}/**/*.ts`],
    ignores: [
      ...TESTS,
      `${SRC}/config/**`,
      `${SRC}/shared/infrastructure/**`,
      `${SRC}/modules/*/infrastructure/**`,
      `${SRC}/generated/**`,
    ],
    rules: {
      ...restrictImports(prismaGroup, processGroup, ...sdkGroups),
      'no-restricted-syntax': ['error', ...processEnv],
    },
  },
  // Infrastructure may import Prisma but not process
  {
    files: [`${SRC}/shared/infrastructure/**/*.ts`, `${SRC}/modules/*/infrastructure/**/*.ts`],
    ignores: TESTS,
    rules: {
      ...restrictImports(processGroup, ...sdkGroups),
      'no-restricted-syntax': ['error', ...processEnv],
    },
  },
  // (a) domain: allowlist; (h) no wall-clock reads
  {
    files: [`${SRC}/modules/*/domain/**/*.ts`, `${SRC}/shared/domain/**/*.ts`],
    ignores: TESTS,
    rules: {
      ...restrictImports(
        prismaGroup,
        processGroup,
        ...sdkGroups,
        bareSpecifierGroup('a', 'domain'),
      ),
      'no-restricted-syntax': ['error', ...processEnv, ...clock],
    },
  },
  // (b) application: allowlist (no @nestjs/*, SDKs or builtins); (h) no wall-clock reads
  {
    files: [`${SRC}/modules/*/application/**/*.ts`, `${SRC}/shared/application/**/*.ts`],
    ignores: TESTS,
    rules: {
      ...restrictImports(
        prismaGroup,
        processGroup,
        ...sdkGroups,
        bareSpecifierGroup('b', 'application'),
      ),
      'no-restricted-syntax': ['error', ...processEnv, ...clock],
    },
  },
  // config may read the environment but never imports a provider SDK
  {
    files: [`${SRC}/config/**/*.ts`],
    ignores: TESTS,
    rules: restrictImports(...sdkGroups),
  },
  // Carve-outs: each adapter folder keeps every restriction except its own SDK
  {
    files: [`${SRC}/modules/integrations/infrastructure/stripe/**/*.ts`],
    ignores: TESTS,
    rules: restrictImports(processGroup, binanceGroup, mcpGroup),
  },
  {
    files: [`${SRC}/modules/integrations/infrastructure/binance/**/*.ts`],
    ignores: TESTS,
    rules: restrictImports(processGroup, stripeGroup, mcpGroup),
  },
  {
    files: [`${SRC}/modules/mcp/interface/mcp/**/*.ts`],
    ignores: TESTS,
    rules: restrictImports(prismaGroup, processGroup, stripeGroup, binanceGroup),
  },
);
