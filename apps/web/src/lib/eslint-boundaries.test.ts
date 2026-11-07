// The import boundaries of the FE hold in the ESLint config (`eslint.config.mjs`): the BE is the only data
// source (DU-03), so the mock layer, `src/server/` and Prisma are forbidden everywhere, tests included.
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: process.cwd() });
  // The first lint loads the whole flat config (Next.js plugins included); keep that out of the cases.
  await eslint.lintText("export {};\n", { filePath: "src/lib/warm-up.ts" });
}, 120_000);

/** Messages of `no-restricted-imports` for `source` linted as if it lived at `filePath`. */
async function restrictedImports(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

// The removed layers are named through this helper so no source line spells their alias path out.
const alias = (layer: "mocks" | "server", rest = "") => `@/${layer}${rest}`;

const FILES = [
  "src/features/clients/queries.ts",
  "src/features/clients/actions.ts",
  "src/features/clients/components/client-form.ts",
  "src/app/page.ts",
  "src/components/patterns/page-header.ts",
  "src/lib/finance/totals.ts",
  "src/proxy.ts",
  "src/lib/auth/session.ts",
  "src/lib/api/client.ts",
];
const TEST_FILES = [
  "src/features/clients/queries.test.ts",
  "src/lib/auth/session.test.ts",
  "tests/e2e/fe-int-0-auth.spec.ts",
  "tests/smoke.test.ts",
];

describe("the mock layer and src/server are gone: nobody imports them", () => {
  const mock = `import { getMockStore } from "${alias("mocks", "/store")}";\nexport const x = getMockStore;\n`;
  const server = `import { readContext } from "${alias("server", "/context")}";\nexport const x = readContext;\n`;

  it.each([...FILES, ...TEST_FILES])("%s may not import the mock layer", async (filePath) => {
    const messages = await restrictedImports(filePath, mock);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(alias("mocks"));
  });

  it.each([...FILES, ...TEST_FILES])("%s may not import src/server", async (filePath) => {
    const messages = await restrictedImports(filePath, server);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(alias("server"));
  });

  it("covers the bare specifiers and the deep sub-paths", async () => {
    for (const source of [
      `import "${alias("mocks")}";\n`,
      `import "${alias("mocks", "/services/catalogs")}";\n`,
      `import "${alias("server")}";\n`,
      `import "${alias("server", "/auth/session")}";\n`,
    ]) {
      expect(await restrictedImports("src/app/a.ts", source)).toHaveLength(1);
      expect(await restrictedImports("src/features/a/a.test.ts", source)).toHaveLength(1);
    }
  });

  it("keeps the session test helper in lib/auth importable from tests", async () => {
    const source =
      'import { makeSessionUser } from "@/lib/auth/testing";\nexport const x = makeSessionUser;\n';
    expect(await restrictedImports("src/features/notes/queries.test.ts", source)).toEqual([]);
  });
});

describe("C7: the FE never touches Prisma", () => {
  const prisma = 'import { PrismaClient } from "@prisma/client";\nexport const p = PrismaClient;\n';
  const generated =
    'import { PrismaClient } from "@/generated/prisma";\nexport const p = PrismaClient;\n';

  it.each([...FILES, ...TEST_FILES])("%s may not", async (filePath) => {
    for (const source of [prisma, generated]) {
      expect((await restrictedImports(filePath, source)).join()).toContain("Prisma");
    }
  });
});

describe("C1/C2: Zod comes from the wrapper", () => {
  const raw = 'import { z } from "zod";\nexport const s = z.string();\n';

  it.each(["src/features/files/actions.ts", "src/lib/auth/session.ts", "src/features/x/x.test.ts"])(
    "%s may not import raw zod",
    async (filePath) => {
      expect((await restrictedImports(filePath, raw)).join()).toContain("@/lib/validators/zod");
    },
  );

  it("may not import a zod sub-path either", async () => {
    const messages = await restrictedImports(
      "src/features/files/actions.ts",
      'import { z } from "zod/v4";\nexport const s = z.string();\n',
    );
    expect(messages.join()).toContain("@/lib/validators/zod");
  });

  it("the wrapper itself is the only importer", async () => {
    expect(await restrictedImports("src/lib/validators/zod.ts", raw)).toEqual([]);
    expect(await restrictedImports("src/lib/validators/zod-config.ts", raw)).toEqual([]);
  });

  it("the wrapper path is allowed", async () => {
    const source = 'import { z } from "@/lib/validators/zod";\nexport const s = z.string();\n';
    expect(await restrictedImports("src/features/files/actions.ts", source)).toEqual([]);
  });
});

describe("C7/C8: openapi-fetch and the generated schema stay under src/lib/api", () => {
  const sources = [
    'import createClient from "openapi-fetch";\nexport const c = createClient;\n',
    'import type { paths } from "@/lib/api/schema";\nexport type P = paths;\n',
  ];

  it.each([
    "src/features/clients/queries.ts",
    "src/features/clients/components/client-form.ts",
    "src/app/page.ts",
    "src/proxy.ts",
    "src/lib/auth/session.ts",
    "src/features/clients/queries.test.ts",
  ])("%s may not", async (filePath) => {
    for (const source of sources) {
      expect((await restrictedImports(filePath, source)).join()).toContain("src/lib/api/**");
    }
  });

  it.each(["src/lib/api/client.ts", "src/lib/api/server.ts", "src/lib/api/client.test.ts"])(
    "%s may",
    async (filePath) => {
      for (const source of sources) {
        expect(await restrictedImports(filePath, source)).toEqual([]);
      }
    },
  );
});

describe("C26: @clerk/nextjs/server is limited to three files", () => {
  const source = 'import { auth } from "@clerk/nextjs/server";\nexport const a = auth;\n';

  it.each(["src/proxy.ts", "src/lib/api/server.ts", "src/lib/auth/session.ts"])(
    "%s may",
    async (filePath) => {
      expect(await restrictedImports(filePath, source)).toEqual([]);
    },
  );

  it.each([
    "src/app/layout.tsx",
    "src/features/clients/queries.ts",
    "src/lib/api/client.ts",
    "src/lib/auth/permissions.ts",
    "src/features/clients/queries.test.ts",
  ])("%s may not", async (filePath) => {
    const messages = await restrictedImports(filePath, source);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("src/lib/auth/session.ts");
  });
});

describe("C7: no global fetch in UI code", () => {
  async function fetchMessages(filePath: string, source: string): Promise<string[]> {
    const [result] = await eslint.lintText(source, { filePath });
    return (result?.messages ?? [])
      .filter(
        (message) =>
          message.ruleId === "no-restricted-globals" ||
          message.ruleId === "no-restricted-properties",
      )
      .map((message) => message.message);
  }

  it.each([
    "src/features/clients/queries.ts",
    "src/components/patterns/page-header.ts",
    "src/app/api/s/route.ts",
  ])("%s may not call fetch", async (filePath) => {
    expect(await fetchMessages(filePath, "export const r = () => fetch('/x');\n")).toHaveLength(1);
    expect(
      await fetchMessages(filePath, "export const r = () => window.fetch('/x');\n"),
    ).toHaveLength(1);
  });

  it("src/lib/api and tests may", async () => {
    const source = "export const r = () => fetch('/x');\n";
    expect(await fetchMessages("src/lib/api/client.ts", source)).toEqual([]);
    expect(await fetchMessages("src/features/clients/queries.test.ts", source)).toEqual([]);
  });
});
