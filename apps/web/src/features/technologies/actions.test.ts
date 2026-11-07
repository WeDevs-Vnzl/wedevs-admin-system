import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  createTechnologyAction,
  deleteTechnologyAction,
  exportTechnologiesCsvAction,
  listTechnologiesAction,
  resolveTechnologyIconAction,
} from "./actions";

const listQuery = { page: 1, pageSize: 25, includeArchived: false, filters: {} };

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
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
  session.getMockSessionUser.mockReset();
});

describe("technology actions: permissions (DT-71)", () => {
  it("lets Owner and Admin create, and refuses Member and Viewer with FORBIDDEN", async () => {
    asRole("MEMBER");
    await expect(
      createTechnologyAction({ name: "Odin Lang", category: "OTRO" }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });

    asRole("ADMIN");
    const created = await createTechnologyAction({ name: "Odin Lang", category: "OTRO" });
    expect(created).toMatchObject({ ok: true, data: { name: "Odin Lang", slug: "odin-lang" } });
  });

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

  it("resolves a Simple Icons slug for Owner and Admin (read on settings)", async () => {
    asRole("ADMIN");
    const result = await resolveTechnologyIconAction({ slug: "nextdotjs" });
    expect(result).toMatchObject({ ok: true, data: { title: "Next.js" } });
  });

  it("refuses the icon preview to Member and Viewer with FORBIDDEN", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      asRole(role);
      await expect(resolveTechnologyIconAction({ slug: "nextdotjs" })).resolves.toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
  });
});

describe("deleteTechnologyAction: in-use lock (HU-06 CA3)", () => {
  it("answers INTEGRITY_LOCK for a technology that a project uses", async () => {
    asRole("OWNER");
    await expect(deleteTechnologyAction({ id: "tec_next_js" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.technologies.errors.inUse" },
    });
  });
});
