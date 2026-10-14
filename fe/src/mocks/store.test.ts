// MOCK — tests for the in-memory store: lazy singleton, reset, derive hooks, sequences.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FIXED_NOW } from "./test-helpers";
import {
  buildMockStore,
  deriveMockStore,
  getMockStore,
  listDeriveHooks,
  registerDeriveHook,
  resetMockStore,
  type MockStore,
} from "./store";

const GLOBAL_KEY = "__wedevsMockState";

function clearGlobalState() {
  delete (globalThis as Record<string, unknown>)[GLOBAL_KEY];
}

beforeEach(clearGlobalState);
afterEach(clearGlobalState);

describe("getMockStore", () => {
  it("builds the store lazily, once, and keeps it on globalThis", () => {
    expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeUndefined();
    const first = getMockStore();
    expect(getMockStore()).toBe(first);
    expect((globalThis as Record<string, unknown>)[GLOBAL_KEY]).toBeDefined();
  });

  it("is built from the fixtures: catalogs, the commercial dataset and the finance seed filled", () => {
    const store = getMockStore();
    expect(store.currencies.map((c) => c.code)).toEqual(["USD", "VES", "EUR", "USDT", "COP"]);
    expect(store.fiscal.ivaRates).toEqual(["16", "8", "0"]);
    expect(store.technologies.length).toBeGreaterThanOrEqual(55);
    for (const name of [
      "clients",
      "contacts",
      "projects",
      "notes",
      "documents",
      "documentVersions",
      "documentLinks",
      "activity",
      "files",
      "billingPlans",
      "installments",
      "recurringCharges",
      "invoices",
      "invoiceTaxLines",
      "payments",
      "paymentAllocations",
      "accounts",
      "transfers",
      "movements",
      "expenses",
      "recurringExpenses",
    ] as const) {
      expect(store[name].length).toBeGreaterThan(0);
    }
    for (const name of [
      "shareLinks",
      "shareDocumentKeys",
      "shareAccessLogs",
      "alertDismissals",
      "preferences",
    ] as const) {
      expect(store[name]).toEqual([]);
    }
  });

  it("holds normalized rows with foreign keys, not denormalized DTOs (PD-3)", () => {
    const store = getMockStore();
    expect(store.clients[0]).toHaveProperty("tagIds");
    expect(store.clients[0]).not.toHaveProperty("tags");
    expect(store.clients[0]).not.toHaveProperty("contacts");
    expect(store.clients[0]).not.toHaveProperty("financials");
    expect(store.contacts[0]).toHaveProperty("clientId");
    expect(store.projects[0]).toHaveProperty("technologyIds");
    expect(store.projects[0]).not.toHaveProperty("stack");
    expect(store.projects[0]).not.toHaveProperty("hasBillingPlan");
    expect(store.notes[0]).toHaveProperty("authorId");
    expect(store.notes[0]).not.toHaveProperty("contentText");
    expect(store.documents[0]).toHaveProperty("typeId");
    expect(store.activity[0]).toHaveProperty("actorId");
    expect(store.activity[0]).not.toHaveProperty("actor");
  });

  it("starts the code sequences at the highest code of the dataset", () => {
    const store = getMockStore();
    expect(store.sequences).toEqual({
      CLI: store.clients.length,
      PRY: store.projects.length,
      FAC: store.invoices.length,
      PAG: store.payments.length,
      GAS: store.expenses.length,
      DOC: store.documents.length,
    });
  });
});

describe("buildMockStore", () => {
  it("never shares objects with the fixtures or with another store", () => {
    const a = buildMockStore(FIXED_NOW);
    const b = buildMockStore(FIXED_NOW);
    a.currencies[0]!.name = "changed";
    a.tags.pop();
    expect(b.currencies[0]!.name).not.toBe("changed");
    expect(b.tags.length).toBe(buildMockStore(FIXED_NOW).tags.length);
  });

  it("anchors the rate history on the given clock", () => {
    const store = buildMockStore(FIXED_NOW);
    const dates = store.exchangeRates.map((r) => r.date).sort();
    expect(dates.at(-1)).toBe("2026-10-09");
  });

  it("has the Δ1 and Δ2 collections", () => {
    const store = buildMockStore(FIXED_NOW);
    expect(Array.isArray(store.invoiceTaxLines)).toBe(true);
    expect(Array.isArray(store.shareDocumentKeys)).toBe(true);
  });
});

describe("resetMockStore", () => {
  it("rebuilds from the fixtures, discarding every mutation", () => {
    const store = getMockStore();
    store.tags.length = 0;
    store.fiscal.ivaRates.push("12");
    store.sequences.CLI = 99;
    store.files.push({
      id: "fil_x",
      originalName: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 10,
      status: "READY",
      uploadedById: "usr_x",
      createdAt: FIXED_NOW.toISOString(),
    });

    resetMockStore(FIXED_NOW);

    expect(store.tags.length).toBeGreaterThan(0);
    expect(store.fiscal.ivaRates).toEqual(["16", "8", "0"]);
    expect(store.sequences.CLI).toBe(store.clients.length);
    expect(store.files).not.toContainEqual(expect.objectContaining({ id: "fil_x" }));
  });

  it("rebuilds the commercial collections, discarding mutations to them", () => {
    const store = getMockStore();
    const counts = {
      clients: store.clients.length,
      contacts: store.contacts.length,
      projects: store.projects.length,
      notes: store.notes.length,
      documents: store.documents.length,
      documentVersions: store.documentVersions.length,
      documentLinks: store.documentLinks.length,
      activity: store.activity.length,
    };
    for (const name of Object.keys(counts) as (keyof typeof counts)[]) store[name].length = 0;

    resetMockStore(FIXED_NOW);

    for (const name of Object.keys(counts) as (keyof typeof counts)[]) {
      expect(store[name]).toHaveLength(counts[name]);
    }
  });

  it("refills the same object, so a context created before the reset sees the fresh data", () => {
    const before = getMockStore();
    const after = resetMockStore(FIXED_NOW);
    expect(after).toBe(before);
    expect(getMockStore()).toBe(before);
  });

  it("creates the store when none exists yet", () => {
    const store = resetMockStore(FIXED_NOW);
    expect(getMockStore()).toBe(store);
  });
});

describe("derive hooks", () => {
  it("run in registration order over a built store and again on demand", () => {
    const calls: string[] = [];
    registerDeriveHook("first", () => calls.push("first"));
    registerDeriveHook("second", () => calls.push("second"));
    expect(listDeriveHooks()).toEqual(["first", "second"]);

    buildMockStore(FIXED_NOW);
    expect(calls).toEqual(["first", "second"]);

    deriveMockStore(buildMockStore(FIXED_NOW));
    expect(calls).toHaveLength(6);
  });

  it("receive the store and may recompute derived values in place", () => {
    registerDeriveHook("flag-tags", (store: MockStore) => {
      for (const tag of store.tags) tag.name = tag.name.toUpperCase();
    });
    const store = buildMockStore(FIXED_NOW);
    expect(store.tags.every((tag) => tag.name === tag.name.toUpperCase())).toBe(true);
  });

  it("replace a hook registered again under the same name (hot reload)", () => {
    const spy = vi.fn();
    registerDeriveHook("dup", () => undefined);
    registerDeriveHook("dup", spy);
    expect(listDeriveHooks()).toEqual(["dup"]);
    buildMockStore(FIXED_NOW);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("survive a reset", () => {
    const spy = vi.fn();
    registerDeriveHook("kept", spy);
    getMockStore();
    spy.mockClear();
    resetMockStore(FIXED_NOW);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe("sequence derivation", () => {
  it("is built in: codes already present raise the sequences when a store is built", () => {
    const store = buildMockStore(FIXED_NOW);
    expect(store.sequences.CLI).toBe(store.clients.length);
    expect(store.clients.at(-1)?.code).toBe(`CLI-${String(store.sequences.CLI).padStart(4, "0")}`);
  });
});
