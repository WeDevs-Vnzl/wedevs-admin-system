import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getServerApi: vi.fn(), revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath, updateTag: mocks.updateTag }));
vi.mock("@/lib/api/server", () => ({ getServerApi: mocks.getServerApi }));

import { entityHref } from "@/lib/entity-routes";
import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import { listTrashAction, restoreFromTrashAction } from "./actions";

const page = {
  items: [
    {
      entity: { id: "pry_veredas_landing", code: "PRY-0007", label: "Landing Veredas", type: "PROJECT" },
      context: "Veredas Digital",
      deletedAt: "2026-10-01T12:00:00.000Z",
      deletedBy: { id: "usr_camila_torres", name: "Camila Torres", imageUrl: null },
    },
  ],
  total: 1,
  page: 1,
  pageSize: 25,
  pageCount: 1,
};

function useRoutes(routes: RouteTable) {
  const mocked = mockApi(routes);
  mocks.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

beforeEach(() => {
  mocks.getServerApi.mockReset();
  mocks.revalidatePath.mockReset();
  mocks.updateTag.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("listTrashAction (HU-28, PRD §7.7)", () => {
  it("reads the archived rows from GET /api/v1/trash and returns the BE page", async () => {
    const { calls } = useRoutes({ "GET /api/v1/trash": { body: page } });
    const result = await listTrashAction({});
    expect(result).toEqual({ ok: true, data: page });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: "GET", path: "/api/v1/trash" });
  });

  it("sends the facets and the page as query keys, never archived", async () => {
    const { calls } = useRoutes({ "GET /api/v1/trash": { body: page } });
    await listTrashAction({
      page: 2,
      pageSize: 50,
      sort: "deletedAt:desc",
      entityType: ["PROJECT"],
      deletedFrom: "2026-10-01",
    });
    const search = calls[0]!.search;
    expect(search.get("page")).toBe("2");
    expect(search.get("pageSize")).toBe("50");
    expect(search.get("sort")).toBe("deletedAt:desc");
    expect(search.getAll("entityType")).toEqual(["PROJECT"]);
    expect(search.get("deletedFrom")).toBe("2026-10-01");
    expect(search.has("archived")).toBe(false);
  });

  it("returns only the rows the BE lists (mixed period, DT-205)", async () => {
    useRoutes({ "GET /api/v1/trash": { body: { ...page, items: [], total: 0 } } });
    const result = await listTrashAction({});
    expect(result).toMatchObject({ ok: true, data: { items: [], total: 0 } });
  });

  it("maps a Member's FORBIDDEN from the BE and returns no rows", async () => {
    useRoutes({ "GET /api/v1/trash": errorEnvelope("FORBIDDEN") });
    expect(await listTrashAction({})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
  });
});

describe("restoreFromTrashAction (HU-28 CA2)", () => {
  const input = { entityType: "PROJECT" as const, entityId: "pry_veredas_landing" };

  it("posts the pair to POST /api/v1/trash/restore and revalidates the trash and the record", async () => {
    const restored = {
      entity: { id: "pry_veredas_landing", label: "Landing Veredas", type: "PROJECT" },
      restoredAt: "2026-10-19T12:00:00.000Z",
    };
    const { calls } = useRoutes({ "POST /api/v1/trash/restore": { body: restored } });
    const result = await restoreFromTrashAction(input);
    expect(result).toEqual({ ok: true, data: restored });
    expect(calls[0]).toMatchObject({
      method: "POST",
      path: "/api/v1/trash/restore",
      body: { entityType: "PROJECT", entityId: "pry_veredas_landing" },
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/trash");
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      entityHref({ type: "PROJECT", id: "pry_veredas_landing" }),
    );
  });

  it("returns the CONFLICT message key and the entity it points at, and does not revalidate", async () => {
    const holder = { type: "CLIENT", id: "cli_kairos", code: "CLI-0001", label: "Kairos" };
    useRoutes({
      "POST /api/v1/trash/restore": errorEnvelope("CONFLICT", {
        message: "trash.errors.clientArchived",
        entity: holder,
      }),
    });
    const result = await restoreFromTrashAction({ entityType: "CONTACT", entityId: "con_1" });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "trash.errors.clientArchived",
        entity: holder,
        correlationId: "test-correlation-id",
      },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps a Member's FORBIDDEN and changes nothing", async () => {
    useRoutes({ "POST /api/v1/trash/restore": errorEnvelope("FORBIDDEN") });
    expect(await restoreFromTrashAction(input)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
