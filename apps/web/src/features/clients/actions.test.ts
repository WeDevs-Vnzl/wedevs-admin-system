import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest";

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

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import type { ClientDetailDto, ClientListResponseDto } from "@/lib/api/types/clients";
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

const detail = {
  id: "cli_nube",
  code: "CLI-0007",
  kind: "EMPRESA",
  tradeName: "Nube Austral",
  legalName: "Nube Austral C.A.",
  taxId: "J-40111222-3",
  country: "VE",
  address: "Av. Principal, Caracas",
  phone: "+584121234567",
  email: null,
  website: null,
  status: "PROSPECTO",
  activatedAt: null,
  tags: [],
  contacts: [],
  createdAt: "2026-11-01T12:00:00.000Z",
  updatedAt: "2026-11-01T12:00:00.000Z",
  archivedAt: null,
} satisfies ClientDetailDto;

function useApi(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockClear();
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createClientAction", () => {
  it("posts the form values and returns the client with the CLI- code from the response", async () => {
    const { calls } = useApi({ "POST /api/v1/clients": { status: 201, body: detail } });
    const result = await createClientAction(validClient);

    expect(result).toMatchObject({ ok: true, data: { id: "cli_nube", code: "CLI-0007" } });
    expect(calls[0]?.body).toEqual({ ...validClient, tagIds: [], status: "PROSPECTO" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients", "layout");
  });

  it("keeps the linked holder when the tax id is a duplicate (HU-03 CA3)", async () => {
    useApi({
      "POST /api/v1/clients": errorEnvelope("CONFLICT", {
        message: "clients.errors.duplicateTaxId",
        entity: { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos Studio" },
      }),
    });
    const result = await createClientAction(validClient);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "clients.errors.duplicateTaxId",
        entity: { id: "cli_kairos", type: "CLIENT", label: "Kairos Studio" },
      },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps the BE field errors for the form", async () => {
    useApi({
      "POST /api/v1/clients": errorEnvelope("VALIDATION", {
        fieldErrors: { taxId: ["validation.invalidFormat"] },
      }),
    });
    expect(await createClientAction({ ...validClient, taxId: "123" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { taxId: ["validation.invalidFormat"] } },
    });
  });
});

describe("updateClientAction and setClientStatusAction", () => {
  it("patches by id without sending the id in the body", async () => {
    const { calls } = useApi({
      "PATCH /api/v1/clients/{id}": { body: { ...detail, tradeName: "Nube Dos" } },
      "POST /api/v1/clients/{id}/status": { body: { ...detail, status: "ACTIVO" } },
    });
    expect(
      await updateClientAction({ ...validClient, id: "cli_nube", tradeName: "Nube Dos" }),
    ).toMatchObject({ ok: true, data: { tradeName: "Nube Dos" } });
    expect(calls[0]?.path).toBe("/api/v1/clients/cli_nube");
    expect(calls[0]?.body).not.toHaveProperty("id");

    expect(await setClientStatusAction({ id: "cli_nube", status: "ACTIVO" })).toMatchObject({
      ok: true,
      data: { status: "ACTIVO" },
    });
    expect(calls[1]?.body).toEqual({ status: "ACTIVO" });
  });

  it("answers a CONFLICT without entity as a plain error (DT-177, X19)", async () => {
    useApi({ "PATCH /api/v1/clients/{id}": errorEnvelope("CONFLICT") });
    const result = await updateClientAction({ ...validClient, id: "cli_nube" });

    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    if (!result.ok) expect(result.error.entity).toBeUndefined();
  });
});

describe("archive and restore actions", () => {
  it("locks without confirm and archives with it, reporting the archived contacts", async () => {
    const { calls } = useApi({
      "POST /api/v1/clients/{id}/archive": (call) =>
        (call.body as { confirm: boolean }).confirm
          ? {
              body: {
                id: "cli_kairos",
                archivedAt: "2026-11-06T12:00:00.000Z",
                archivedContacts: 3,
              },
            }
          : errorEnvelope("INTEGRITY_LOCK", { message: "clients.errors.archiveNeedsConfirm" }),
    });

    expect(await archiveClientAction({ id: "cli_kairos" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "clients.errors.archiveNeedsConfirm" },
    });
    expect(await archiveClientAction({ id: "cli_kairos", confirm: true })).toMatchObject({
      ok: true,
      data: { id: "cli_kairos", archivedContacts: 3 },
    });
    expect(calls.map((call) => call.body)).toEqual([{ confirm: false }, { confirm: true }]);
  });

  it("archives a selection through POST /clients/archive", async () => {
    const { calls } = useApi({
      "POST /api/v1/clients/archive": {
        body: {
          archived: [{ id: "cli_a", archivedAt: "2026-11-06T12:00:00.000Z", archivedContacts: 0 }],
        },
      },
    });
    expect(await archiveClientsAction({ ids: ["cli_a"], confirm: true })).toMatchObject({
      ok: true,
      data: { archived: [{ id: "cli_a" }] },
    });
    expect(calls[0]?.body).toEqual({ ids: ["cli_a"], confirm: true });
  });

  it("restores, and keeps the entity of a restore CONFLICT", async () => {
    useApi({
      "POST /api/v1/clients/{id}/restore": errorEnvelope("CONFLICT", {
        entity: { type: "CLIENT", id: "cli_holder", code: "CLI-0009", label: "Holder" },
      }),
    });
    expect(await restoreClientAction({ id: "cli_zafiro_labs" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", entity: { id: "cli_holder" } },
    });
  });

  it("surfaces the BE refusal for a role without the trash grant", async () => {
    useApi({ "POST /api/v1/clients/{id}/restore": errorEnvelope("FORBIDDEN") });
    expect(await restoreClientAction({ id: "cli_kairos" })).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("searchClientsAction", () => {
  it("returns EntityRefs, parsing the wire null code to undefined", async () => {
    const { calls } = useApi({
      "GET /api/v1/clients/search": {
        body: [
          { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos Studio" },
          { type: "CLIENT", id: "cli_sin_codigo", code: null, label: "Sin código" },
        ],
      },
    });
    const result = await searchClientsAction({ q: " kairos " });

    expect(result).toEqual({
      ok: true,
      data: [
        { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos Studio" },
        { type: "CLIENT", id: "cli_sin_codigo", code: undefined, label: "Sin código" },
      ],
    });
    expect(calls[0]?.search.get("q")).toBe("kairos");
    expect(calls[0]?.search.get("limit")).toBe("20");
  });

  it("maps the error envelope", async () => {
    useApi({ "GET /api/v1/clients/search": errorEnvelope("UNAUTHENTICATED") });
    expect(await searchClientsAction({})).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  // Frozen for W3/W4 (DT-218): the typeahead keeps its input and result types.
  it("keeps its frozen signature", () => {
    expectTypeOf(searchClientsAction).parameter(0).toEqualTypeOf<{ q?: string | undefined }>();
    expectTypeOf(searchClientsAction).returns.toEqualTypeOf<Promise<ActionResult<EntityRef[]>>>();
  });
});

describe("listClientsAction", () => {
  const empty: ClientListResponseDto = { items: [], total: 0, page: 1, pageSize: 25, pageCount: 0 };

  it("sends the table filter as flat query params", async () => {
    const { calls } = useApi({ "GET /api/v1/clients": { body: empty } });
    await listClientsAction({ q: "kairos", status: "ACTIVO", sort: "tradeName:asc", pageSize: 50 });

    expect(calls[0]?.search.get("q")).toBe("kairos");
    expect(calls[0]?.search.getAll("status")).toEqual(["ACTIVO"]);
    expect(calls[0]?.search.get("sort")).toBe("tradeName:asc");
    expect(calls[0]?.search.get("pageSize")).toBe("50");
    expect(calls[0]?.search.get("archived")).toBe("exclude");
  });

  it("returns the rows of a Member with null money", async () => {
    useApi({
      "GET /api/v1/clients": {
        body: {
          ...empty,
          total: 1,
          items: [
            {
              id: "cli_kairos",
              code: "CLI-0001",
              tradeName: "Kairos Studio",
              kind: "EMPRESA",
              country: "VE",
              status: "ACTIVO",
              projectCount: 2,
              totalInvoicedUsd: null,
              receivableUsd: null,
              tags: [],
              lastActivityAt: null,
              archivedAt: null,
            },
          ],
        },
      },
    });
    expect(await listClientsAction({})).toMatchObject({
      ok: true,
      data: { items: [{ totalInvoicedUsd: null, receivableUsd: null }] },
    });
  });

  it("surfaces the BE refusal of a money sort for a Member", async () => {
    useApi({
      "GET /api/v1/clients": errorEnvelope("VALIDATION", {
        fieldErrors: { sort: ["validation.sort.invalid"] },
      }),
    });
    expect(await listClientsAction({ sort: "totalInvoicedUsd:desc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { sort: ["validation.sort.invalid"] } },
    });
  });

  it("rejects a bad filter before the call", async () => {
    const { calls } = useApi({ "GET /api/v1/clients": { body: empty } });
    expect(await listClientsAction({ page: 0 })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
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
