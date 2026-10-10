// MOCK — the import restrictions of C7, C9 and C11 hold in the ESLint config (`eslint.config.mjs`).
import { ESLint } from "eslint";
import { beforeAll, describe, expect, it } from "vitest";

let eslint: ESLint;

beforeAll(async () => {
  eslint = new ESLint({ cwd: process.cwd() });
  // The first lint loads the whole flat config (Next.js plugins included); keep that out of the cases.
  await eslint.lintText("export {};\n", { filePath: "src/mocks/warm-up.ts" });
}, 120_000);

/** Messages of `no-restricted-imports` for `source` linted as if it lived at `filePath`. */
async function restrictedImports(filePath: string, source: string): Promise<string[]> {
  const [result] = await eslint.lintText(source, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === "no-restricted-imports")
    .map((message) => message.message);
}

const importMock =
  'import { getMockStore } from "@/mocks/store";\nexport const x = getMockStore;\n';

describe("C9: only these files may import @/mocks/**", () => {
  it.each([
    "src/features/clients/queries.ts",
    "src/features/clients/actions.ts",
    "src/server/context.ts",
    "src/server/auth/session.ts",
    "src/mocks/services/clients.ts",
    "src/mocks/fixtures/clients.ts",
    "src/features/clients/queries.test.ts",
  ])("%s may", async (filePath) => {
    expect(await restrictedImports(filePath, importMock)).toEqual([]);
  });

  it.each([
    "src/app/page.ts",
    "src/components/patterns/page-header.ts",
    "src/features/clients/components/client-form.ts",
    "src/features/clients/server-utils.ts",
    "src/lib/finance/totals.ts",
    "src/server/actions/define-action.ts",
    "src/server/actions/define-public-action.ts",
    "src/server/services/clients.service.ts",
  ])("%s may not", async (filePath) => {
    const messages = await restrictedImports(filePath, importMock);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Mock code is isolated (C9)");
  });

  it("covers the sub-paths and the bare specifier", async () => {
    expect(await restrictedImports("src/app/a.ts", 'import "@/mocks";\n')).toHaveLength(1);
    expect(
      await restrictedImports("src/app/a.ts", 'import "@/mocks/services/catalogs";\n'),
    ).toHaveLength(1);
  });
});

describe("C7: nothing outside src/server touches Prisma", () => {
  const prisma = 'import { PrismaClient } from "@prisma/client";\nexport const p = PrismaClient;\n';

  it.each(["src/features/clients/queries.ts", "src/mocks/services/clients.ts", "src/app/page.ts"])(
    "%s may not",
    async (filePath) => {
      expect((await restrictedImports(filePath, prisma)).join()).toContain(
        "Prisma is only reachable inside src/server/",
      );
    },
  );

  it("src/server may", async () => {
    expect(await restrictedImports("src/server/db/client.ts", prisma)).toEqual([]);
  });
});

describe("C11: mock services are framework-free", () => {
  it.each([
    "next/headers",
    "next/cache",
    "react",
    "next-intl",
    "next-intl/server",
    "@clerk/nextjs",
  ])("src/mocks/services may not import %s", async (specifier) => {
    const messages = await restrictedImports(
      "src/mocks/services/files.ts",
      `import "${specifier}";\n`,
    );
    expect(messages.join()).toContain("Services are framework-free (C11)");
  });

  it("may import the store and the validators", async () => {
    const source =
      'import { getMockStore } from "@/mocks/store";\nimport { idSchema } from "@/lib/validators/common";\nexport const x = [getMockStore, idSchema];\n';
    expect(await restrictedImports("src/mocks/services/files.ts", source)).toEqual([]);
  });

  it("the server adapters and the actions may use next/*", async () => {
    const source =
      'import { revalidatePath } from "next/cache";\nexport const x = revalidatePath;\n';
    expect(await restrictedImports("src/server/actions/define-action.ts", source)).toEqual([]);
    expect(await restrictedImports("src/features/session/actions.ts", source)).toEqual([]);
  });
});

describe("C1/C2: Zod comes from the wrapper", () => {
  it.each([
    "src/features/files/actions.ts",
    "src/server/actions/define-action.ts",
    "src/mocks/store.ts",
  ])("%s may not import raw zod", async (filePath) => {
    const messages = await restrictedImports(
      filePath,
      'import { z } from "zod";\nexport const s = z.string();\n',
    );
    expect(messages.join()).toContain("@/lib/validators/zod");
  });

  it("the wrapper itself is the only importer", async () => {
    const source = 'import { z } from "zod";\nexport { z };\n';
    expect(await restrictedImports("src/lib/validators/zod.ts", source)).toEqual([]);
  });
});
