import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { locales } from "../src/i18n/config";
import { namespaces } from "../src/i18n/namespaces";

// C2: every key exists in every locale, every namespace file exists, and no value is empty.

export type Catalog = Record<string, unknown>;

// locale -> namespace -> parsed catalog (undefined when the file is missing)
export type Catalogs = Record<string, Record<string, Catalog | undefined>>;

export type CheckInput = {
  catalogs: Catalogs;
  locales: readonly string[];
  namespaces: readonly string[];
  // Namespace files found on disk that the fixed list does not declare.
  unknownFiles?: string[];
};

type Leaf = { key: string; value: unknown };

function collectLeaves(node: unknown, prefix = ""): Leaf[] {
  if (typeof node !== "object" || node === null || Array.isArray(node)) {
    return [{ key: prefix, value: node }];
  }
  return Object.entries(node).flatMap(([name, child]) =>
    collectLeaves(child, prefix ? `${prefix}.${name}` : name),
  );
}

export function checkCatalogs({
  catalogs,
  locales: localeList,
  namespaces: namespaceList,
  unknownFiles = [],
}: CheckInput): string[] {
  const problems: string[] = [];

  for (const file of unknownFiles) {
    problems.push(`unknown namespace file (not in namespaces.ts): ${file}`);
  }

  for (const namespace of namespaceList) {
    const keysByLocale = new Map<string, Set<string>>();

    for (const locale of localeList) {
      const catalog = catalogs[locale]?.[namespace];
      if (catalog === undefined) {
        problems.push(`missing namespace file: ${locale}/${namespace}.json`);
        continue;
      }

      const leaves = collectLeaves(catalog);
      for (const { key, value } of leaves) {
        if (typeof value !== "string") {
          problems.push(`non-string value in ${locale}/${namespace}.json: ${key}`);
        } else if (value.trim() === "") {
          problems.push(`empty value in ${locale}/${namespace}.json: ${key}`);
        }
      }
      keysByLocale.set(locale, new Set(leaves.map((leaf) => leaf.key)));
    }

    const [reference, ...others] = localeList;
    const referenceKeys = reference !== undefined ? keysByLocale.get(reference) : undefined;
    if (reference === undefined || referenceKeys === undefined) continue;

    for (const locale of others) {
      const keys = keysByLocale.get(locale);
      if (keys === undefined) continue;

      for (const key of referenceKeys) {
        if (!keys.has(key)) problems.push(`missing key in ${locale}/${namespace}.json: ${key}`);
      }
      for (const key of keys) {
        if (!referenceKeys.has(key))
          problems.push(`extra key in ${locale}/${namespace}.json: ${key}`);
      }
    }
  }

  return problems;
}

// Reads src/i18n/messages/<locale>/<namespace>.json from disk. Throws on invalid JSON.
export function loadCatalogs(messagesDir: string, localeList: readonly string[]) {
  const catalogs: Catalogs = {};
  const unknownFiles: string[] = [];

  for (const locale of localeList) {
    const localeDir = join(messagesDir, locale);
    catalogs[locale] = {};

    for (const namespace of namespaces) {
      const file = join(localeDir, `${namespace}.json`);
      if (!existsSync(file)) continue;
      catalogs[locale][namespace] = parseCatalog(file);
    }

    if (existsSync(localeDir)) {
      for (const entry of readdirSync(localeDir)) {
        const name = entry.replace(/\.json$/, "");
        if (!entry.endsWith(".json") || !(namespaces as readonly string[]).includes(name)) {
          unknownFiles.push(`${locale}/${entry}`);
        }
      }
    }
  }

  return { catalogs, unknownFiles };
}

function parseCatalog(file: string): Catalog {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Catalog;
  } catch (error) {
    throw new Error(`invalid JSON in ${file}: ${(error as Error).message}`);
  }
}

export function runCheck(messagesDir: string): number {
  if (!existsSync(messagesDir)) {
    console.error(`i18n check failed: messages directory not found: ${messagesDir}`);
    return 1;
  }

  const { catalogs, unknownFiles } = loadCatalogs(messagesDir, locales);
  const problems = checkCatalogs({ catalogs, locales, namespaces, unknownFiles });

  if (problems.length > 0) {
    console.error(`i18n check failed with ${problems.length} problem(s):`);
    for (const problem of problems) console.error(`  - ${problem}`);
    return 1;
  }

  console.log(
    `i18n check passed: ${locales.join(", ")} x ${namespaces.length} namespaces, keys in parity.`,
  );
  return 0;
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isEntrypoint) {
  const messagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/i18n/messages");
  try {
    process.exitCode = runCheck(messagesDir);
  } catch (error) {
    console.error(`i18n check failed: ${(error as Error).message}`);
    process.exitCode = 1;
  }
}
