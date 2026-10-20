import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * RSC boundary guard. jsdom/Vitest does not enforce the client/server split: a server module that imports a
 * *value* from a `"use client"` module gets a client reference under RSC (a constant becomes `NaN`/garbage, a
 * function cannot be called). Only components (PascalCase, rendered as elements) and types may cross.
 */

const SRC = resolve(__dirname, "..");
const EXTENSIONS = [".ts", ".tsx"];

/** Explicit, justified exceptions as `"<file relative to src>:<binding>"`. Prefer fixing the import. */
const ALLOW_LIST: readonly string[] = [
  // Kit barrels (read-only) re-export client hooks/helpers. A re-export is not a use: every consumer of these
  // bindings today is itself a "use client" module (the *-table.tsx files, data-table.tsx, note-composer.tsx).
  "components/ui/data-table/index.ts:useTableUrlState",
  "components/ui/money-input/index.ts:useDecimalText",
  "components/ui/rich-text/index.ts:parseRichText",
  "components/ui/rich-text/index.ts:EMPTY_RICH_TEXT",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (
      /\.tsx?$/.test(entry) &&
      !/\.(test|spec)\.tsx?$/.test(entry) &&
      !entry.endsWith(".d.ts")
    )
      out.push(full);
  }
  return out;
}

function resolveModule(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  const candidates = [
    base,
    ...EXTENSIONS.map((e) => base + e),
    ...EXTENSIONS.map((e) => join(base, `index${e}`)),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile()) ?? null;
}

function parse(file: string) {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function isClientModule(sf: ts.SourceFile): boolean {
  for (const stmt of sf.statements) {
    if (ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)) {
      if (stmt.expression.text === "use client") return true;
    } else break;
  }
  return false;
}

const isComponentName = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);

type Crossing = { specifier: string; bindings: string[] };

/** Value bindings (type-only ones excluded) a module takes from each of its relative / `@/` specifiers. */
function valueImports(sf: ts.SourceFile): Crossing[] {
  const found: Crossing[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt) && ts.isStringLiteral(stmt.moduleSpecifier)) {
      const clause = stmt.importClause;
      if (!clause || clause.isTypeOnly) continue;
      const bindings: string[] = [];
      if (clause.name) bindings.push(clause.name.text);
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) bindings.push(nb.name.text);
      else if (nb)
        for (const el of nb.elements)
          if (!el.isTypeOnly) bindings.push((el.propertyName ?? el.name).text);
      found.push({ specifier: stmt.moduleSpecifier.text, bindings });
    } else if (
      ts.isExportDeclaration(stmt) &&
      stmt.moduleSpecifier &&
      ts.isStringLiteral(stmt.moduleSpecifier) &&
      !stmt.isTypeOnly
    ) {
      const bindings: string[] = [];
      const ec = stmt.exportClause;
      if (!ec) bindings.push("*");
      else if (ts.isNamespaceExport(ec)) bindings.push(ec.name.text);
      else
        for (const el of ec.elements)
          if (!el.isTypeOnly) bindings.push((el.propertyName ?? el.name).text);
      found.push({ specifier: stmt.moduleSpecifier.text, bindings });
    }
  }
  return found;
}

function findViolations(files: string[]): string[] {
  const parsed = new Map(files.map((f) => [f, parse(f)]));
  const violations: string[] = [];
  for (const [file, sf] of parsed) {
    if (isClientModule(sf)) continue;
    for (const { specifier, bindings } of valueImports(sf)) {
      const target = resolveModule(file, specifier);
      if (!target) continue;
      const targetSf = parsed.get(target) ?? parse(target);
      if (!isClientModule(targetSf)) continue;
      for (const binding of bindings) {
        if (isComponentName(binding)) continue;
        const rel = relative(SRC, file);
        if (ALLOW_LIST.includes(`${rel}:${binding}`)) continue;
        violations.push(
          `${rel}: imports value "${binding}" from client module ${relative(SRC, target)}`,
        );
      }
    }
  }
  return violations;
}

describe("RSC boundary", () => {
  it('no server module imports a non-component value from a "use client" module', () => {
    expect(findViolations(walk(SRC))).toEqual([]);
  });
});
