import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

import type { UserRole } from "@/lib/validators/enums";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  archiveClientAction,
  archiveClientsAction,
  createClientAction,
  exportClientsCsvAction,
  listClientsAction,
  restoreClientAction,
  searchClientsAction,
  setClientStatusAction,
  updateClientAction,
} from "./actions";

const validClient = {
  kind: "EMPRESA",
  tradeName: "Nube Austral",
  legalName: "Nube Austral C.A.",
  taxId: "J-40111222-3",
  country: "VE",
  address: "Av. Principal, Caracas",
  phone: "+584121234567",
} as const;

function signInAs(role: UserRole) {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role, { id: `usr_${role}` }));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createClientAction", () => {
  it("creates the client for Owner and Admin and revalidates /clients", async () => {
    for (const role of ["OWNER", "ADMIN"] as const) {
      signInAs(role);
      const result = await createClientAction({
        ...validClient,
        taxId: role === "OWNER" ? "J-40111221-3" : "J-40111222-3",
      });
      expect(result).toMatchObject({
        ok: true,
        data: { status: "PROSPECTO", tradeName: "Nube Austral" },
      });
    }
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients", "layout");
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses a %s with FORBIDDEN and changes nothing",
    async (role) => {
      signInAs(role);
      const count = getMockStore().clients.length;
      expect(await createClientAction(validClient)).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(getMockStore().clients).toHaveLength(count);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await createClientAction(validClient)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("answers VALIDATION with field errors for a bad input", async () => {
    signInAs("OWNER");
    const result = await createClientAction({
      ...validClient,
      tradeName: "",
      taxId: "123",
      phone: "x",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    if (!result.ok) {
      expect(Object.keys(result.error.fieldErrors ?? {})).toEqual(
        expect.arrayContaining(["tradeName", "taxId", "phone"]),
      );
    }
  });

  it("answers CONFLICT and keeps the linked entity through the adapter (HU-03 CA3)", async () => {
    signInAs("OWNER");
    const result = await createClientAction({ ...validClient, taxId: "J-30123456-7" });
    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "clients.errors.duplicateTaxId",
        entity: { id: "cli_kairos", type: "CLIENT", label: "Kairos Studio" },
      },
    });
  });
});

describe("updateClientAction and setClientStatusAction", () => {
  it("updates for Admin, refuses Member, and keeps entity on CONFLICT", async () => {
    signInAs("ADMIN");
    const created = await createClientAction(validClient);
    if (!created.ok) throw new Error("setup failed");
    const update = { ...validClient, id: created.data.id };
    expect(await updateClientAction({ ...update, tradeName: "Nube Dos" })).toMatchObject({
      ok: true,
      data: { tradeName: "Nube Dos" },
    });
    expect(await updateClientAction({ ...update, taxId: "J-30123456-7" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", entity: { id: "cli_kairos" } },
    });
    expect(await setClientStatusAction({ id: created.data.id, status: "ACTIVO" })).toMatchObject({
      ok: true,
      data: { status: "ACTIVO" },
    });
    signInAs("MEMBER");
    expect(await updateClientAction(update)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await setClientStatusAction({ id: created.data.id, status: "INACTIVO" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("archive and restore actions", () => {
  it("locks without confirm, archives with it, and only Owner/Admin may restore", async () => {
    signInAs("OWNER");
    expect(await archiveClientAction({ id: "cli_kairos" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "clients.errors.archiveNeedsConfirm" },
    });
    expect(await archiveClientAction({ id: "cli_kairos", confirm: true })).toMatchObject({
      ok: true,
      data: { id: "cli_kairos" },
    });

    signInAs("MEMBER");
    expect(await restoreClientAction({ id: "cli_kairos" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await archiveClientsAction({ ids: ["cli_zafiro_labs"] })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });

    signInAs("ADMIN");
    expect(await restoreClientAction({ id: "cli_kairos" })).toMatchObject({
      ok: true,
      data: { archivedAt: null },
    });
  });

  it("restore keeps entity on CONFLICT; bulk archive validates the selection", async () => {
    signInAs("OWNER");
    await archiveClientAction({ id: "cli_zafiro_labs" });
    const store = getMockStore();
    const zafiro = store.clients.find((c) => c.id === "cli_zafiro_labs")!;
    const holder = await createClientAction({
      ...validClient,
      taxId: zafiro.taxId,
      country: zafiro.country,
    });
    expect(await restoreClientAction({ id: "cli_zafiro_labs" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", entity: { id: holder.ok ? holder.data.id : "" } },
    });
    expect(await archiveClientsAction({ ids: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("searchClientsAction", () => {
  it("returns at most 20 EntityRefs for any role that can read clients", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      signInAs(role);
      const result = await searchClientsAction({});
      expect(result.ok && result.data.length).toBe(20);
    }
    signInAs("VIEWER");
    expect(await searchClientsAction({ q: "kairos" })).toMatchObject({
      ok: true,
      data: [{ id: "cli_kairos", type: "CLIENT", label: "Kairos Studio" }],
    });
  });

  it("requires a session", async () => {
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await searchClientsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("listClientsAction", () => {
  it("returns the filtered page to any role that can read clients (filter passthrough)", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      signInAs(role);
      const result = await listClientsAction({ q: "kairos", page: 1, pageSize: 25, filters: {} });
      expect(result).toMatchObject({
        ok: true,
        data: { total: 1, items: [{ id: "cli_kairos", tradeName: "Kairos Studio" }] },
      });
    }
  });

  it("rejects a bad filter with VALIDATION and a missing session with UNAUTHENTICATED", async () => {
    signInAs("ADMIN");
    expect(await listClientsAction({ page: 0, pageSize: 25, filters: {} })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await listClientsAction({ page: 1, pageSize: 25, filters: {} })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});

describe("exportClientsCsvAction", () => {
  const payload = {
    entity: "CLIENT" as const,
    query: { filters: { status: "ACTIVO" } },
    columns: ["code", "tradeName", "status", "totalInvoicedUsd", "tags"],
  };

  it("exports the filtered table with translated headers and money verbatim", async () => {
    signInAs("VIEWER");
    const result = await exportClientsCsvAction(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [header, ...rows] = result.data.content.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe(
      "clients.columns.code,clients.columns.tradeName,clients.columns.status,clients.columns.totalInvoicedUsd,clients.columns.tags",
    );
    const active = getMockStore().clients.filter((c) => !c.archivedAt && c.status === "ACTIVO");
    expect(rows).toHaveLength(active.length);
    expect(result.data).toMatchObject({ rowCount: active.length, truncated: false });
    expect(rows.every((row) => row.includes(",ACTIVO,0.00,"))).toBe(true);
  });

  it("rejects an unknown column with VALIDATION and a missing session with UNAUTHENTICATED", async () => {
    signInAs("OWNER");
    expect(await exportClientsCsvAction({ ...payload, columns: ["code", "nope"] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await exportClientsCsvAction(payload)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
