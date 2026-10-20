import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("server-safe table URL state", () => {
  it("has no 'use client' directive and no client-only nuqs import", () => {
    const source = read("src/components/ui/data-table/table-url-state.ts");
    expect(source).not.toMatch(/^\s*["']use client["']/m);
    expect(source).not.toMatch(/from "nuqs"/);
    expect(source).toMatch(/from "nuqs\/server"/);
  });

  it("keeps the hook module as the client boundary", () => {
    expect(read("src/components/ui/data-table/use-table-url-state.ts")).toMatch(/^"use client"/);
  });

  it.each([
    "src/app/(app)/clients/list/page.tsx",
    "src/app/(app)/projects/list/page.tsx",
    "src/app/(app)/notes/page.tsx",
  ])("%s does not import the helpers from the client hook module", (page) => {
    expect(read(page)).not.toMatch(/use-table-url-state/);
  });
});
