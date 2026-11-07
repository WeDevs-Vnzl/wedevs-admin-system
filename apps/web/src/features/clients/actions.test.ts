import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

import { errorEnvelope, mockApi } from "@/lib/api/testing";
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
    // Zafiro has the open seeded invoice FAC-0004, so archiving it needs the C19 confirmation.
    await archiveClientAction({ id: "cli_zafiro_labs", confirm: true });
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

  /** Routes the server client of the export action to an HTTP double of `POST /exports/CLIENT`. */
  function exportApi(response?: () => Response) {
    const mocked = mockApi({
      "POST /api/v1/exports/CLIENT":
        response ??
        (() =>
          new Response("h\r\n", {
            status: 200,
            headers: {
              "content-type": "text/csv; charset=utf-8",
              "X-Export-Row-Count": "2",
              "X-Export-Truncated": "false",
            },
          })),
    });
    server.getServerApi.mockResolvedValue(mocked.api);
    return mocked;
  }

  const errorResponse = (code: Parameters<typeof errorEnvelope>[0]) => () => {
    const { status, body } = errorEnvelope(code);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };

  it("posts the visible columns, their translated labels and the filter to /exports/CLIENT", async () => {
    const { calls } = exportApi();
    const result = await exportClientsCsvAction(payload);
    expect(result).toMatchObject({ ok: true, data: { rowCount: 2, truncated: false } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.body).toEqual({
      columns: payload.columns.map((id) => ({ id, label: `clients.columns.${id}` })),
      query: { archived: "exclude", filters: { status: "ACTIVO" } },
    });
  });

  it("maps the UNAUTHENTICATED envelope and rejects an empty column list with VALIDATION", async () => {
    const { calls } = exportApi(errorResponse("UNAUTHENTICATED"));
    expect(await exportClientsCsvAction(payload)).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(await exportClientsCsvAction({ ...payload, columns: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(1);
  });
});
