import { describe, expect, it } from "vitest";

/**
 * Every validation message key a validator exports (C1: schemas carry i18n keys, never prose) must
 * resolve to a non-empty string in both languages. Keys look like `<namespace>.validation.<name>` or
 * `validation.<group>.<name>` (the shared namespace); the first segment is the namespace file.
 */

const validatorModules = import.meta.glob(["./*.ts", "!./*.test.ts"], { eager: true }) as Record<
  string,
  Record<string, unknown>
>;
const catalogs = import.meta.glob("../../i18n/messages/*/*.json", {
  eager: true,
  import: "default",
}) as Record<string, unknown>;

const LOCALES = ["es", "en"] as const;
const VALIDATION_KEY = /^(?:[a-z][A-Za-z]*\.validation|validation)\.[A-Za-z][A-Za-z0-9.]*$/;

/** Collects the validation keys held by plain exported objects and strings (not schemas). */
function collectKeys(value: unknown, into: Map<string, string>, source: string, depth = 0): void {
  if (typeof value === "string") {
    if (VALIDATION_KEY.test(value)) into.set(value, source);
    return;
  }
  if (depth > 2 || value === null || typeof value !== "object" || Array.isArray(value)) return;
  // Zod schemas and other class instances are not message maps.
  if (Object.getPrototypeOf(value) !== Object.prototype) return;
  for (const child of Object.values(value)) collectKeys(child, into, source, depth + 1);
}

function exportedKeys(): Map<string, string> {
  const keys = new Map<string, string>();
  for (const [file, module] of Object.entries(validatorModules)) {
    for (const exported of Object.values(module)) collectKeys(exported, keys, file);
  }
  return keys;
}

function resolveKey(locale: string, key: string): unknown {
  const [namespace, ...path] = key.split(".");
  let node = catalogs[`../../i18n/messages/${locale}/${namespace}.json`];
  for (const part of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

describe("validator message keys", () => {
  const keys = exportedKeys();

  it("finds the message maps of the contract modules", () => {
    expect(keys.size).toBeGreaterThan(40);
    expect(keys.has("validation.id.invalid")).toBe(true);
    expect(keys.has("invoices.validation.dueBeforeIssue")).toBe(true);
    expect(keys.has("documents.validation.signedAtNotAllowed")).toBe(true);
  });

  it.each(LOCALES)("every exported key exists in %s", (locale) => {
    const missing = [...keys]
      .filter(([key]) => {
        const text = resolveKey(locale, key);
        return typeof text !== "string" || text.trim() === "";
      })
      .map(([key, source]) => `${key} (${source})`);
    expect(missing).toEqual([]);
  });

  it("documents.validation keys are present in both languages", () => {
    for (const locale of LOCALES) {
      for (const name of ["signedAtNotAllowed", "expiresAtNotAllowed", "signedStatusNotAllowed"]) {
        expect(resolveKey(locale, `documents.validation.${name}`), `${locale}:${name}`).toEqual(
          expect.any(String),
        );
      }
    }
  });
});
