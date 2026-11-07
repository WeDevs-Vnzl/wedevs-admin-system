import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ requireSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireSessionUser: session.requireSessionUser,
}));
vi.mock("next-intl/server", () => intl);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { UnauthenticatedError } from "@/lib/auth/session";
import { makeSessionUser } from "@/lib/auth/testing";
import {
  createTechnologyAction,
  deleteTechnologyAction,
  exportTechnologiesCsvAction,
  listTechnologiesAction,
  resolveTechnologyIconAction,
  setTechnologyActiveAction,
  updateTechnologyAction,
} from "./actions";

const listQuery = { page: 1, pageSize: 25, includeArchived: false, filters: {} };

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.requireSessionUser.mockResolvedValue(makeSessionUser(role));
}

/** Routes the server client of the export action to an HTTP double of `POST /exports/TECHNOLOGY`. */
function exportApi(response?: () => Response) {
  const mocked = mockApi({
    "POST /api/v1/exports/TECHNOLOGY":
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
beforeEach(() => {
  session.requireSessionUser.mockReset();
  cache.revalidatePath.mockReset();
  cache.updateTag.mockReset();
});

/** The catalogue row the BE returns for a technology (`TechnologyViewDto`). */
const nextJs = {
  id: "tec_next_js",
  name: "Next.js",
  nameEn: null,
  slug: "next-js",
  category: "FRONTEND",
  iconSlug: "nextdotjs",
  color: null,
  active: true,
  usageCount: 2,
};

describe("technology writes through the API (DT-71)", () => {
  it("creates through POST /api/v1/technologies and refreshes Settings", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/technologies": {
        status: 201,
        body: {
          ...nextJs,
          id: "tec_odin",
          name: "Odin Lang",
          slug: "odin-lang",
          category: "OTRO",
          usageCount: 0,
        },
      },
    });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await createTechnologyAction({ name: "Odin Lang", category: "OTRO", active: true }),
    ).toMatchObject({
      ok: true,
      data: { name: "Odin Lang", slug: "odin-lang" },
    });
    expect(calls[0]?.body).toMatchObject({ name: "Odin Lang", category: "OTRO", active: true });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/technologies");
  });

  it("refuses a Member with FORBIDDEN from the BE and refreshes nothing", async () => {
    const { api } = mockApi({ "POST /api/v1/technologies": errorEnvelope("FORBIDDEN") });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      createTechnologyAction({ name: "Odin Lang", category: "OTRO", active: true }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps the CONFLICT field key of a taken name onto the field", async () => {
    const { api } = mockApi({
      "POST /api/v1/technologies": errorEnvelope("CONFLICT", {
        fieldErrors: { name: ["catalogs.technologies.errors.nameTaken"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      createTechnologyAction({ name: "Next.js", category: "FRONTEND", active: true }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        fieldErrors: { name: ["catalogs.technologies.errors.nameTaken"] },
      },
    });
  });
});

describe("updateTechnologyAction and setTechnologyActiveAction", () => {
  it("replaces the editable fields through PATCH /api/v1/technologies/{id}, without the id or slug", async () => {
    const { api, calls } = mockApi({
      "PATCH /api/v1/technologies/{id}": { body: { ...nextJs, active: false } },
    });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await updateTechnologyAction({
        id: nextJs.id,
        name: "Next.js",
        nameEn: undefined,
        slug: "next-js",
        category: "FRONTEND",
        iconSlug: "nextdotjs",
        color: undefined,
        active: false,
      }),
    ).toMatchObject({ ok: true, data: { id: nextJs.id, active: false } });
    expect(calls[0]?.path).toBe("/api/v1/technologies/tec_next_js");
    expect(calls[0]?.body).toEqual({
      name: "Next.js",
      category: "FRONTEND",
      iconSlug: "nextdotjs",
      active: false,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/technologies");
  });

  it("answers NOT_FOUND when the technology is gone", async () => {
    const { api } = mockApi({ "PATCH /api/v1/technologies/{id}": errorEnvelope("NOT_FOUND") });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      updateTechnologyAction({ id: "tec_gone", name: "X", category: "OTRO", active: true }),
    ).resolves.toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("deactivates through POST /api/v1/technologies/{id}/active", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/technologies/{id}/active": { body: { ...nextJs, active: false } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      setTechnologyActiveAction({ id: nextJs.id, active: false }),
    ).resolves.toMatchObject({
      ok: true,
      data: { active: false },
    });
    expect(calls[0]?.path).toBe("/api/v1/technologies/tec_next_js/active");
    expect(calls[0]?.body).toEqual({ active: false });
  });
});

describe("technology actions: permissions (DT-71)", () => {
  it("lets any signed-in role read the reference catalog (authenticated)", async () => {
    const { api, calls } = mockApi({
      "GET /api/v1/technologies": {
        body: { items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
      },
    });
    server.getServerApi.mockResolvedValue(api);
    const result = await listTechnologiesAction({ pageSize: 25, category: ["IA"] });
    expect(result).toEqual({
      ok: true,
      data: { items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
    });
    expect(calls[0]?.search.getAll("category")).toEqual(["IA"]);
  });

  it("answers VALIDATION for a sort the table cannot send, without calling the BE", async () => {
    const { api, calls } = mockApi({});
    server.getServerApi.mockResolvedValue(api);
    expect(await listTechnologiesAction({ sort: "nope:asc" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });

  it("maps the FORBIDDEN envelope of the CSV export", async () => {
    exportApi(errorResponse("FORBIDDEN"));
    await expect(
      exportTechnologiesCsvAction({ entity: "TECHNOLOGY", query: listQuery, columns: ["name"] }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("posts the translated catalog columns to /exports/TECHNOLOGY", async () => {
    const { calls } = exportApi();
    const result = await exportTechnologiesCsvAction({
      entity: "TECHNOLOGY",
      query: listQuery,
      columns: ["name", "usageCount"],
    });
    expect(result).toMatchObject({ ok: true, data: { rowCount: 2 } });
    expect(calls[0]?.body).toMatchObject({
      columns: [
        { id: "name", label: "catalogs:technologies.table.columns.name" },
        { id: "usageCount", label: "catalogs:technologies.table.columns.usageCount" },
      ],
      query: { archived: "exclude" },
    });
  });

  it("resolves a Simple Icons slug for any signed-in user (the BE owns the grants)", async () => {
    for (const role of ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const) {
      asRole(role);
      const result = await resolveTechnologyIconAction({ slug: "nextdotjs" });
      expect(result).toMatchObject({ ok: true, data: { title: "Next.js" } });
    }
  });

  it("answers UNAUTHENTICATED when nobody is signed in", async () => {
    session.requireSessionUser.mockRejectedValue(new UnauthenticatedError());
    await expect(resolveTechnologyIconAction({ slug: "nextdotjs" })).resolves.toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("answers VALIDATION for an invalid slug", async () => {
    asRole("OWNER");
    await expect(
      resolveTechnologyIconAction({ slug: "Not A Slug!" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });
});

describe("deleteTechnologyAction", () => {
  it("deletes an unused technology through DELETE /api/v1/technologies/{id}", async () => {
    const { api, calls } = mockApi({
      "DELETE /api/v1/technologies/{id}": { body: { id: "tec_odin" } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(deleteTechnologyAction({ id: "tec_odin" })).resolves.toEqual({
      ok: true,
      data: { id: "tec_odin" },
    });
    expect(calls[0]?.path).toBe("/api/v1/technologies/tec_odin");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/technologies");
  });

  it("answers INTEGRITY_LOCK for a technology that a project uses (HU-06 CA3)", async () => {
    const { api } = mockApi({
      "DELETE /api/v1/technologies/{id}": errorEnvelope("INTEGRITY_LOCK", {
        message: "catalogs.technologies.errors.inUse",
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(deleteTechnologyAction({ id: "tec_next_js" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.technologies.errors.inUse" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});
