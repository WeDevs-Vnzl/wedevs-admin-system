import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import i18next from "eslint-plugin-i18next";

// The BE is the only data source (DU-03): the mock layer and `src/server/` are gone, and nobody may bring them
// back (tests included).
const removedLayerImports = {
  group: ["@/mocks", "@/mocks/**", "@/server", "@/server/**"],
  message:
    "The mock layer and src/server/ are gone (DU-03): data comes from the BE through the typed client in src/lib/api/**.",
};

const prismaImports = {
  group: ["@prisma/*", "@/generated/prisma", "@/generated/prisma/**"],
  message: "The FE never touches Prisma or a database (DU-03, C7): the BE owns the data.",
};

const apiClientMessage =
  "The generated schema and openapi-fetch are only reachable inside src/lib/api/** (C7, C8): call the BE through the typed client.";

const openapiFetchImports = { name: "openapi-fetch", message: apiClientMessage };
const apiSchemaImports = {
  group: [
    "@/lib/api/schema",
    "@/lib/api/schema.d.ts",
    "@wedevs/api-contract",
    "@wedevs/api-contract/*",
  ],
  message: apiClientMessage,
};
const apiImports = [openapiFetchImports, apiSchemaImports];

const clerkServerImports = {
  group: ["@clerk/nextjs/server"],
  message:
    "@clerk/nextjs/server is only allowed in src/proxy.ts, src/lib/api/server.ts and src/lib/auth/session.ts (C26).",
};

const zodMessage =
  'Import { z } from "@/lib/validators/zod": it guarantees the global Zod error map (i18n keys) is installed (C1, C2).';

// Exact-name `paths` entry: a `patterns` group named "zod" would also match the relative "./zod".
const zodImports = { name: "zod", message: zodMessage };

// `zod/*` subpaths (`zod/v4`, `zod/mini`, ...) bypass the wrapper just the same. The pattern `zod/*`
// cannot match the relative "./zod" or "@/lib/validators/zod".
const zodSubpathImports = { group: ["zod/*"], message: zodMessage };

// Entries with a `name` become `paths` (exact module); entries with a `group` become `patterns`.
const restrict = (...entries) => ({
  "no-restricted-imports": [
    "error",
    {
      paths: entries.filter((entry) => entry.name),
      patterns: entries.filter((entry) => entry.group),
    },
  ],
});

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/generated/**",
  ]),

  // C7: default for every source file, tests and e2e specs included: no mock layer, no src/server, no Prisma, no
  // raw zod, no openapi-fetch or generated schema outside src/lib/api/**, no Clerk server helpers.
  {
    files: ["**/*.{ts,tsx,mts,mjs}"],
    rules: restrict(
      removedLayerImports,
      prismaImports,
      zodImports,
      zodSubpathImports,
      ...apiImports,
      clerkServerImports,
    ),
  },

  // C1, C2: the only modules that import the raw "zod" package; every other file imports `z` from
  // `@/lib/validators/zod`.
  {
    files: ["src/lib/validators/zod.ts", "src/lib/validators/zod-config.ts"],
    rules: restrict(removedLayerImports, prismaImports, ...apiImports, clerkServerImports),
  },

  // C7, C8: the single API client lives in src/lib/api/**; openapi-fetch and the generated schema are
  // importable there only. Clerk server helpers: server.ts alone.
  {
    files: ["src/lib/api/**/*.{ts,tsx}"],
    rules: restrict(
      removedLayerImports,
      prismaImports,
      zodImports,
      zodSubpathImports,
      clerkServerImports,
    ),
  },
  {
    files: ["src/lib/api/server.ts"],
    rules: restrict(removedLayerImports, prismaImports, zodImports, zodSubpathImports),
  },
  // C26: the other places allowed to import @clerk/nextjs/server.
  {
    files: ["src/proxy.ts", "src/lib/auth/session.ts"],
    rules: restrict(
      removedLayerImports,
      prismaImports,
      zodImports,
      zodSubpathImports,
      ...apiImports,
    ),
  },

  // C7: no global fetch in UI code; the BE is reached through the typed client from src/lib/api/**.
  {
    files: ["src/features/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["**/*.test.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "fetch", message: "No global fetch in UI code (C7): use the typed API client." },
      ],
      "no-restricted-properties": [
        "error",
        ...["window", "globalThis", "self"].map((object) => ({
          object,
          property: "fetch",
          message: "No global fetch in UI code (C7): use the typed API client.",
        })),
      ],
    },
  },

  // C1: no literal strings in JSX text; user-facing copy comes from next-intl messages.
  {
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx", "src/features/**/*.tsx"],
    // Exclusion: only the flat registry-generated files (src/components/ui/*.tsx) keep their built-in
    // English sr-only strings until a later package localizes them (C3 allows i18n edits to generated
    // files). Hand-written kit subfolders (src/components/ui/<name>/**) stay linted for C1.
    ignores: ["**/*.test.tsx", "src/components/ui/*.tsx"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": ["error", { mode: "jsx-text-only" }],
    },
  },

  // Exclusion: `src/hooks/use-mobile.ts` is generated by the shadcn CLI (sidebar dependency) and trips
  // react-hooks/set-state-in-effect; the registry file is left untouched.
  {
    files: ["src/hooks/use-mobile.ts"],
    rules: { "react-hooks/set-state-in-effect": "off" },
  },
]);
