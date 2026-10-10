import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { locales } from "../src/i18n/config";
import { namespaces } from "../src/i18n/namespaces";
import { checkCatalogs, loadCatalogs, type Catalogs } from "./check-i18n";

const fixtureNamespaces = ["common", "shell"] as const;

function fixture(overrides: Catalogs = {}): Catalogs {
  return {
    es: {
      common: { actions: { save: "Guardar", cancel: "Cancelar" } },
      shell: { themeToggle: { label: "Cambiar tema" } },
      ...overrides.es,
    },
    en: {
      common: { actions: { save: "Save", cancel: "Cancel" } },
      shell: { themeToggle: { label: "Switch theme" } },
      ...overrides.en,
    },
  };
}

const run = (catalogs: Catalogs, unknownFiles?: string[]) =>
  checkCatalogs({
    catalogs,
    locales: ["es", "en"],
    namespaces: fixtureNamespaces,
    unknownFiles,
  });

describe("checkCatalogs", () => {
  it("passes when both locales have the same keys and no empty values", () => {
    expect(run(fixture())).toEqual([]);
  });

  it("reports a key present in es but missing in en", () => {
    const catalogs = fixture({
      en: {
        common: { actions: { save: "Save" } },
        shell: { themeToggle: { label: "Switch theme" } },
      },
    });

    expect(run(catalogs)).toEqual(["missing key in en/common.json: actions.cancel"]);
  });

  it("reports a key present in en but not declared in es", () => {
    const catalogs = fixture({
      en: {
        common: { actions: { save: "Save", cancel: "Cancel", close: "Close" } },
        shell: { themeToggle: { label: "Switch theme" } },
      },
    });

    expect(run(catalogs)).toEqual(["extra key in en/common.json: actions.close"]);
  });

  it("reports a namespace file that is missing for one locale", () => {
    const catalogs = fixture();
    delete catalogs.en!.shell;

    expect(run(catalogs)).toEqual(["missing namespace file: en/shell.json"]);
  });

  it("reports an empty-string value", () => {
    const catalogs = fixture({
      en: {
        common: { actions: { save: "", cancel: "Cancel" } },
        shell: { themeToggle: { label: "Switch theme" } },
      },
    });

    expect(run(catalogs)).toEqual(["empty value in en/common.json: actions.save"]);
  });

  it("reports a whitespace-only value as empty", () => {
    const catalogs = fixture({
      es: {
        common: { actions: { save: "   ", cancel: "Cancelar" } },
        shell: { themeToggle: { label: "Cambiar tema" } },
      },
    });

    expect(run(catalogs)).toEqual(["empty value in es/common.json: actions.save"]);
  });

  it("reports a non-string leaf", () => {
    const catalogs = fixture({
      en: {
        common: { actions: { save: 3, cancel: "Cancel" } },
        shell: { themeToggle: { label: "Switch theme" } },
      },
    });

    expect(run(catalogs)).toEqual(["non-string value in en/common.json: actions.save"]);
  });

  it("reports namespace files that the fixed list does not declare", () => {
    expect(run(fixture(), ["es/legacy.json"])).toEqual([
      "unknown namespace file (not in namespaces.ts): es/legacy.json",
    ]);
  });
});

describe("real message catalogs", () => {
  it("are in parity with the namespace list", () => {
    const messagesDir = resolve(dirname(fileURLToPath(import.meta.url)), "../src/i18n/messages");
    const { catalogs, unknownFiles } = loadCatalogs(messagesDir, locales);

    expect(checkCatalogs({ catalogs, locales, namespaces, unknownFiles })).toEqual([]);
  });
});
