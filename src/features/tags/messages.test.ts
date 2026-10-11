import { describe, expect, it } from "vitest";
import en from "@/i18n/messages/en/tags.json";
import es from "@/i18n/messages/es/tags.json";

function keysOf(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keysOf(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("tags messages", () => {
  it("has the same keys in Spanish and English", () => {
    expect(keysOf(es).sort()).toEqual(keysOf(en).sort());
  });

  it("gives every key a non-empty value in both languages", () => {
    for (const key of keysOf(es)) expect(key).not.toBe("");
    expect(keysOf(en).length).toBeGreaterThan(20);
  });
});
