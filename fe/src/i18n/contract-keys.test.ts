import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locales } from "./config";
import { ERROR_CODE_VALUES, VALIDATION_MESSAGES } from "@/lib/validators/common";
import { GENERIC_VALIDATION_MESSAGES } from "@/lib/validators/zod-config";
import { ENUM_REGISTRY } from "@/lib/validators/enums";

// Contract keys (C2): every i18n key referenced by a validator or an action result resolves to a
// non-empty string in every locale, and the `enums` catalog mirrors ENUM_REGISTRY.

const messagesDir = join(dirname(fileURLToPath(import.meta.url)), "messages");

function loadNamespace(locale: string, namespace: string): unknown {
  return JSON.parse(readFileSync(join(messagesDir, locale, `${namespace}.json`), "utf8"));
}

// `namespace.a.b` → the string at that path, or undefined when it is missing or not a string.
function resolveKey(locale: string, key: string): string | undefined {
  const [namespace = "", ...path] = key.split(".");
  let node: unknown = loadNamespace(locale, namespace);
  for (const segment of path) {
    if (typeof node !== "object" || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : undefined;
}

describe.each(locales)("contract keys (%s)", (locale) => {
  it.each(Object.entries(VALIDATION_MESSAGES))(
    "%s resolves to a non-empty string",
    (_name, key) => {
      const value = resolveKey(locale, key);
      expect(value, key).toBeTypeOf("string");
      expect(value?.trim(), key).not.toBe("");
    },
  );

  it("registers every generic key and leaves no orphan in validation.json", () => {
    const registered = new Set(Object.values(VALIDATION_MESSAGES).map(String));
    for (const key of Object.values(GENERIC_VALIDATION_MESSAGES))
      expect(registered.has(key)).toBe(true);

    const leaves: string[] = [];
    const walk = (node: unknown, path: string[]) => {
      if (typeof node === "object" && node !== null) {
        for (const [k, v] of Object.entries(node)) walk(v, [...path, k]);
      } else {
        leaves.push(["validation", ...path].join("."));
      }
    };
    walk(loadNamespace(locale, "validation"), []);
    expect(leaves.sort()).toEqual([...registered].sort());
  });

  it("validation.file.tooLarge has no placeholder; tooLargeMax interpolates {max}", () => {
    expect(resolveKey(locale, VALIDATION_MESSAGES.fileTooLarge)).not.toContain("{");
    expect(resolveKey(locale, VALIDATION_MESSAGES.fileTooLargeMax)).toContain("{max}");
  });

  it.each(ERROR_CODE_VALUES)("common.errors.%s resolves to a non-empty string", (code) => {
    const key = `common.errors.${code}`;
    const value = resolveKey(locale, key);
    expect(value, key).toBeTypeOf("string");
    expect(value?.trim(), key).not.toBe("");
  });

  it("enums catalog keys equal ENUM_REGISTRY", () => {
    const catalog = loadNamespace(locale, "enums") as Record<string, Record<string, unknown>>;
    expect(Object.keys(catalog).sort()).toEqual(Object.keys(ENUM_REGISTRY).sort());

    for (const [name, values] of Object.entries(ENUM_REGISTRY)) {
      expect(Object.keys(catalog[name] ?? {}).sort(), name).toEqual([...values].sort());
    }
  });
});
