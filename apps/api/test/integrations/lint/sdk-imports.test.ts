import { resolve } from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = resolve(__dirname, '../../..');
const INTEGRATIONS = 'src/modules/integrations';

interface Case {
  readonly name: string;
  readonly file: string;
  readonly code: string;
  /** Fragment of the expected message, or null when the import must be allowed. */
  readonly expect: string | null;
}

const STRIPE = 'Rule (i)';
const BINANCE = 'Rule (j)';
const MCP = 'Rule (k)';

const importing = (specifier: string) =>
  `import * as sdk from '${specifier}';\nexport const x = sdk;\n`;

const cases: readonly Case[] = [
  // First-party folders named after a provider are not the SDK
  {
    name: 'first-party use-cases/stripe import from a module',
    file: `${INTEGRATIONS}/stripe.module.ts`,
    code: importing('./application/use-cases/stripe/handle-stripe-webhook.use-case'),
    expect: null,
  },
  {
    name: 'first-party infrastructure/binance import from a module',
    file: `${INTEGRATIONS}/exchange.module.ts`,
    code: importing('./infrastructure/binance/binance-exchange'),
    expect: null,
  },
  {
    name: 'stripe subpath outside its adapter folder',
    file: `${INTEGRATIONS}/stripe.module.ts`,
    code: importing('stripe/cjs/stripe.cjs.node'),
    expect: STRIPE,
  },
  // Stripe: only integrations/infrastructure/stripe
  {
    name: 'stripe in its adapter folder',
    file: `${INTEGRATIONS}/infrastructure/stripe/adapter.ts`,
    code: importing('stripe'),
    expect: null,
  },
  {
    name: 'stripe subpath in its adapter folder',
    file: `${INTEGRATIONS}/infrastructure/stripe/deep/adapter.ts`,
    code: importing('stripe/cjs/stripe.cjs.node'),
    expect: null,
  },
  {
    name: 'stripe in domain',
    file: `${INTEGRATIONS}/domain/bad.ts`,
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in application',
    file: `${INTEGRATIONS}/application/ports/bad.ts`,
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in application use cases',
    file: `${INTEGRATIONS}/application/use-cases/bad.ts`,
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in integrations interface',
    file: `${INTEGRATIONS}/interface/http/bad.ts`,
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in the binance folder',
    file: `${INTEGRATIONS}/infrastructure/binance/bad.ts`,
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in another context infrastructure',
    file: 'src/modules/finance/infrastructure/bad.ts',
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in shared interface',
    file: 'src/shared/interface/bad.ts',
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in shared infrastructure',
    file: 'src/shared/infrastructure/bad.ts',
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe in config',
    file: 'src/config/bad.ts',
    code: importing('stripe'),
    expect: STRIPE,
  },
  {
    name: 'stripe subpath in domain',
    file: `${INTEGRATIONS}/domain/bad.ts`,
    code: importing('stripe/cjs/stripe.cjs.node'),
    expect: STRIPE,
  },

  // Binance connector: only integrations/infrastructure/binance
  {
    name: 'binance connector in its adapter folder',
    file: `${INTEGRATIONS}/infrastructure/binance/adapter.ts`,
    code: importing('@binance/connector'),
    expect: null,
  },
  {
    name: 'binance connector in domain',
    file: `${INTEGRATIONS}/domain/bad.ts`,
    code: importing('@binance/connector'),
    expect: BINANCE,
  },
  {
    name: 'binance spot scope in application',
    file: `${INTEGRATIONS}/application/bad.ts`,
    code: importing('@binance/spot'),
    expect: BINANCE,
  },
  {
    name: 'binance unscoped client in interface',
    file: `${INTEGRATIONS}/interface/http/bad.ts`,
    code: importing('binance'),
    expect: BINANCE,
  },
  {
    name: 'binance-api-node in shared',
    file: 'src/shared/interface/bad.ts',
    code: importing('binance-api-node'),
    expect: BINANCE,
  },
  {
    name: 'binance connector in the stripe folder',
    file: `${INTEGRATIONS}/infrastructure/stripe/bad.ts`,
    code: importing('@binance/connector'),
    expect: BINANCE,
  },
  {
    name: 'binance connector in config',
    file: 'src/config/bad.ts',
    code: importing('@binance/connector'),
    expect: BINANCE,
  },

  // MCP SDK: only modules/mcp/interface/mcp
  {
    name: 'mcp sdk in its server folder',
    file: 'src/modules/mcp/interface/mcp/server.ts',
    code: importing('@modelcontextprotocol/sdk/server/mcp.js'),
    expect: null,
  },
  {
    name: 'mcp sdk in domain',
    file: `${INTEGRATIONS}/domain/bad.ts`,
    code: importing('@modelcontextprotocol/sdk'),
    expect: MCP,
  },
  {
    name: 'mcp sdk in application',
    file: 'src/modules/clients/application/bad.ts',
    code: importing('@modelcontextprotocol/sdk/types.js'),
    expect: MCP,
  },
  {
    name: 'mcp sdk in a context tool file',
    file: 'src/modules/commercial/interface/mcp/clients.tools.ts',
    code: importing('@modelcontextprotocol/sdk/server/mcp.js'),
    expect: MCP,
  },
  {
    name: 'mcp sdk in the mcp http interface',
    file: 'src/modules/mcp/interface/http/bad.ts',
    code: importing('@modelcontextprotocol/sdk/server/mcp.js'),
    expect: MCP,
  },
  {
    name: 'mcp sdk in shared interface',
    file: 'src/shared/interface/bad.ts',
    code: importing('@modelcontextprotocol/sdk/server/mcp.js'),
    expect: MCP,
  },
  {
    name: 'mcp sdk in infrastructure',
    file: `${INTEGRATIONS}/infrastructure/stripe/bad.ts`,
    code: importing('@modelcontextprotocol/sdk'),
    expect: MCP,
  },
  {
    name: 'mcp sdk in config',
    file: 'src/config/bad.ts',
    code: importing('@modelcontextprotocol/sdk'),
    expect: MCP,
  },

  // Existing rules keep working inside the carve-outs
  {
    name: 'prisma still refused in the mcp server folder',
    file: 'src/modules/mcp/interface/mcp/bad.ts',
    code: importing('@prisma/client'),
    expect: 'Rule (f)',
  },
  {
    name: 'process still refused in the stripe adapter folder',
    file: `${INTEGRATIONS}/infrastructure/stripe/bad.ts`,
    code: importing('node:process'),
    expect: 'Rule (g)',
  },
  {
    name: 'process.env still refused in the binance adapter folder',
    file: `${INTEGRATIONS}/infrastructure/binance/bad.ts`,
    code: 'export const k = process.env.X;\n',
    expect: 'Rule (g)',
  },
];

describe('SDK import lint rules (C11, wave 1 package 1.3)', { timeout: 60_000 }, () => {
  let eslint: ESLint;

  beforeAll(() => {
    eslint = new ESLint({
      cwd: ROOT,
      overrideConfigFile: resolve(ROOT, 'eslint.config.mjs'),
      ignore: false,
    });
  });

  it.each(cases)('$name', async (testCase) => {
    const [result] = await eslint.lintText(testCase.code, {
      filePath: resolve(ROOT, testCase.file),
    });
    const messages = result?.messages ?? [];
    if (testCase.expect === null) {
      expect(messages.map((m) => `${m.ruleId}: ${m.message}`)).toEqual([]);
    } else {
      const hit = messages.filter((m) => m.message.includes(testCase.expect as string));
      expect(hit.length, JSON.stringify(messages)).toBeGreaterThan(0);
    }
  });
});
