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
  getTranslations: async (namespace: string) => (key: string) => `${namespace}:${key}`,
}));

import { errorEnvelope, mockApi, type RouteTable } from "@/lib/api/testing";
import type { ActionResult, EntityRef } from "@/lib/validators/common";
import type { UserRole } from "@/lib/validators/enums";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  archiveProjectAction,
  archiveProjectsAction,
  createProjectAction,
  exportProjectsCsvAction,
  listProjectsAction,
  removeProjectLinkAction,
  reorderProjectLinksAction,
  searchProjectsAction,
  setProjectClientsAction,
  setProjectStatusAction,
  setProjectTechnologiesAction,
  updateProjectAction,
  upsertProjectLinksAction,
} from "./actions";

// Only the CSV export source still reads the mock session (the export helper, until CLEAN).
const as = (role: UserRole) => session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));

function use(routes: RouteTable) {
  const mocked = mockApi(routes);
  server.getServerApi.mockResolvedValue(mocked.api);
  return mocked;
}

const detail = {
  id: "pry_new",
  code: "PRY-0007",
  name: "Sitio de prueba",
  summary: "Un proyecto de prueba",
  status: "PROPUESTA",
  description: null,
  startDate: null,
  targetEndDate: null,
  endDate: null,
  clients: [],
  stack: [],
  tags: [],
  links: [],
  hasBillingPlan: false,
  archivedAt: null,
  contractedValueUsd: null,
  invoicedUsd: null,
  collectedUsd: null,
  toInvoiceUsd: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};
const link = {
  id: "lnk_1",
  group: "OTRO",
  label: "Wiki",
  url: "https://wiki.example.com",
  order: 0,
};

const newProject = {
  name: "Sitio de prueba",
  summary: "Un proyecto de prueba",
  clients: [{ clientId: "cli_kairos", role: "Contratante" }],
};
const edit = {
  id: "pry_kairos_web",
  name: "Sitio web Kairos renovado",
  summary: "Resumen actualizado",
  startDate: "2026-07-26",
  clients: [{ clientId: "cli_kairos", role: "Contratante" }],
  technologyIds: ["tec_next_js"],
  tagIds: [],
};

beforeEach(() => {
  session.getMockSessionUser.mockReset();
  cache.revalidatePath.mockReset();
  server.getServerApi.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createProjectAction", () => {
  it("posts to /projects with the clients and roles, and revalidates the project paths", async () => {
    const { calls } = use({ "POST /api/v1/projects": { status: 201, body: detail } });
    expect(await createProjectAction(newProject)).toEqual({ ok: true, data: detail });
    expect(calls[0]?.body).toMatchObject({
      name: "Sitio de prueba",
      summary: "Un proyecto de prueba",
      clients: [{ clientId: "cli_kairos", role: "Contratante" }],
      links: [],
      technologyIds: [],
      tagIds: [],
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients", "layout");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/activity", "layout");
  });

  it("shows the BE refusal of a Member as FORBIDDEN and revalidates nothing", async () => {
    use({ "POST /api/v1/projects": errorEnvelope("FORBIDDEN") });
    expect(await createProjectAction(newProject)).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("maps an inactive or unknown technology to the field error (HU-06 CA1)", async () => {
    use({
      "POST /api/v1/projects": errorEnvelope("VALIDATION", {
        fieldErrors: { technologyIds: ["projects.errors.technologyUnknown"] },
      }),
    });
    expect(await createProjectAction({ ...newProject, technologyIds: ["tec_off"] })).toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { technologyIds: ["projects.errors.technologyUnknown"] },
      },
    });
  });

  it("maps a link URL error to links.<i>.url (HU-07 CA3)", async () => {
    use({
      "POST /api/v1/projects": errorEnvelope("VALIDATION", {
        fieldErrors: { "links.1.url": ["validation.invalidUrl"] },
      }),
    });
    expect(
      await createProjectAction({
        ...newProject,
        links: [
          { group: "OTRO", label: "Ok", url: "https://ok.example.com", order: 0 },
          { group: "OTRO", label: "Mal", url: "ftp://x", order: 1 },
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { "links.1.url": ["validation.invalidUrl"] } },
    });
  });
});

describe("updateProjectAction and the other update calls", () => {
  it("lets a Member update: PATCH /projects/{id} without the id in the body", async () => {
    const { calls } = use({ "PATCH /api/v1/projects/{id}": { body: { ...detail, id: edit.id } } });
    expect(await updateProjectAction(edit)).toMatchObject({ ok: true, data: { id: edit.id } });
    expect(calls[0]?.path).toBe("/api/v1/projects/pry_kairos_web");
    expect(calls[0]?.body).toMatchObject({ name: "Sitio web Kairos renovado", tagIds: [] });
    expect(calls[0]?.body).not.toHaveProperty("id");
  });

  it("answers a missing project with NOT_FOUND", async () => {
    use({ "PATCH /api/v1/projects/{id}": errorEnvelope("NOT_FOUND") });
    expect(await updateProjectAction({ ...edit, id: "pry_nope" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });

  it("keeps a CONFLICT without an entity as a generic error (DT-177)", async () => {
    use({ "PATCH /api/v1/projects/{id}": errorEnvelope("CONFLICT") });
    const result = await updateProjectAction(edit);
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(result.ok ? null : result.error.entity).toBeUndefined();
  });

  it("replaces the clients, the stack and the links through their PUT routes", async () => {
    const { calls } = use({
      "PUT /api/v1/projects/{id}/clients": { body: detail },
      "PUT /api/v1/projects/{id}/technologies": { body: detail },
      "PUT /api/v1/projects/{id}/links": { body: { links: [link] } },
    });
    expect(
      await setProjectClientsAction({ projectId: "pry_1", clients: [{ clientId: "cli_kairos" }] }),
    ).toMatchObject({ ok: true });
    expect(
      await setProjectTechnologiesAction({ projectId: "pry_1", technologyIds: ["tec_react"] }),
    ).toMatchObject({ ok: true });
    expect(
      await upsertProjectLinksAction({
        projectId: "pry_1",
        links: [{ group: "OTRO", label: "Wiki", url: "https://wiki.example.com" }],
      }),
    ).toMatchObject({ ok: true, data: { links: [link] } });
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      "PUT /api/v1/projects/pry_1/clients",
      "PUT /api/v1/projects/pry_1/technologies",
      "PUT /api/v1/projects/pry_1/links",
    ]);
    expect(calls[0]?.body).toEqual({ clients: [{ clientId: "cli_kairos" }] });
    expect(calls[1]?.body).toEqual({ technologyIds: ["tec_react"] });
    expect(calls[2]?.body).toEqual({
      links: [{ group: "OTRO", label: "Wiki", url: "https://wiki.example.com", order: 0 }],
    });
  });

  it("reorders one group of links and removes a link", async () => {
    const { calls } = use({
      "POST /api/v1/projects/{id}/links/reorder": { body: { links: [link] } },
      "DELETE /api/v1/projects/{id}/links/{linkId}": { body: { links: [] } },
    });
    expect(
      await reorderProjectLinksAction({
        projectId: "pry_1",
        group: "REPOSITORIO",
        orderedLinkIds: ["lnk_2", "lnk_1"],
      }),
    ).toMatchObject({ ok: true });
    expect(calls[0]?.body).toEqual({ group: "REPOSITORIO", orderedLinkIds: ["lnk_2", "lnk_1"] });
    expect(await removeProjectLinkAction({ projectId: "pry_1", linkId: "lnk_1" })).toMatchObject({
      ok: true,
      data: { links: [] },
    });
    expect(calls[1]?.path).toBe("/api/v1/projects/pry_1/links/lnk_1");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  });
});

describe("setProjectStatusAction", () => {
  const changed = { project: { ...detail, status: "PAUSADO" }, hints: [] };

  it("posts the transition and returns the project with the hints", async () => {
    const { calls } = use({
      "POST /api/v1/projects/{id}/status": {
        body: { ...changed, hints: ["NO_BILLING_PLAN"] },
      },
    });
    expect(
      await setProjectStatusAction({ id: "pry_1", status: "EN_CURSO", startDate: "2026-11-01" }),
    ).toMatchObject({ ok: true, data: { hints: ["NO_BILLING_PLAN"] } });
    expect(calls[0]?.path).toBe("/api/v1/projects/pry_1/status");
    expect(calls[0]?.body).toEqual({
      status: "EN_CURSO",
      startDate: "2026-11-01",
      confirm: false,
      cancelPendingInstallments: false,
      finishRecurringCharges: false,
    });
  });

  it("sends the cancel options with confirm for CANCELADO", async () => {
    const { calls } = use({ "POST /api/v1/projects/{id}/status": { body: changed } });
    await setProjectStatusAction({
      id: "pry_1",
      status: "CANCELADO",
      confirm: true,
      cancelPendingInstallments: true,
      finishRecurringCharges: true,
    });
    expect(calls[0]?.body).toEqual({
      status: "CANCELADO",
      confirm: true,
      cancelPendingInstallments: true,
      finishRecurringCharges: true,
    });
  });

  it("maps EN_CURSO without a start date to VALIDATION on startDate (HU-08 CA1)", async () => {
    use({
      "POST /api/v1/projects/{id}/status": errorEnvelope("VALIDATION", {
        fieldErrors: { startDate: ["validation.required"] },
      }),
    });
    expect(await setProjectStatusAction({ id: "pry_1", status: "EN_CURSO" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { startDate: ["validation.required"] } },
    });
  });

  it("maps CANCELADO without confirm to VALIDATION on confirm", async () => {
    use({
      "POST /api/v1/projects/{id}/status": errorEnvelope("VALIDATION", {
        fieldErrors: { confirm: ["validation.required"] },
      }),
    });
    expect(await setProjectStatusAction({ id: "pry_1", status: "CANCELADO" })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { confirm: ["validation.required"] } },
    });
  });

  it("keeps a CONFLICT without an entity as a generic error (DT-177)", async () => {
    use({ "POST /api/v1/projects/{id}/status": errorEnvelope("CONFLICT") });
    const result = await setProjectStatusAction({ id: "pry_1", status: "PAUSADO" });
    expect(result).toMatchObject({ ok: false, error: { code: "CONFLICT" } });
    expect(result.ok ? null : result.error.entity).toBeUndefined();
  });
});

describe("archive actions", () => {
  it("archives one project without confirm, then with confirm", async () => {
    const { calls } = use({
      "POST /api/v1/projects/{id}/archive": {
        body: { id: "pry_1", archivedAt: "2026-11-06T10:00:00.000Z" },
      },
    });
    expect(await archiveProjectAction({ id: "pry_1" })).toMatchObject({
      ok: true,
      data: { id: "pry_1" },
    });
    await archiveProjectAction({ id: "pry_1", confirm: true });
    expect(calls.map((c) => c.body)).toEqual([{ confirm: false }, { confirm: true }]);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects", "layout");
  });

  it("surfaces INTEGRITY_LOCK of an open installment so the dialog asks for confirmation (HU-08 CA3)", async () => {
    use({
      "POST /api/v1/projects/{id}/archive": errorEnvelope("INTEGRITY_LOCK", {
        message: "projects.errors.archiveNeedsConfirm",
      }),
      "POST /api/v1/projects/archive": errorEnvelope("INTEGRITY_LOCK"),
    });
    expect(await archiveProjectAction({ id: "pry_1" })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "projects.errors.archiveNeedsConfirm" },
    });
    expect(await archiveProjectsAction({ ids: ["pry_1", "pry_2"] })).toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("archives several projects through POST /projects/archive", async () => {
    const { calls } = use({
      "POST /api/v1/projects/archive": {
        body: {
          archived: [
            { id: "pry_1", archivedAt: "2026-11-06T10:00:00.000Z" },
            { id: "pry_2", archivedAt: "2026-11-06T10:00:00.000Z" },
          ],
        },
      },
    });
    expect(await archiveProjectsAction({ ids: ["pry_1", "pry_2"] })).toMatchObject({
      ok: true,
      data: { archived: [{ id: "pry_1" }, { id: "pry_2" }] },
    });
    expect(calls[0]?.body).toEqual({ ids: ["pry_1", "pry_2"], confirm: false });
  });
});

describe("searchProjectsAction", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({
    id: `pry_${i}`,
    code: `PRY-${String(i).padStart(4, "0")}`,
    name: `Proyecto ${i}`,
  }));

  it("returns at most 20 EntityRef options from GET /projects?q", async () => {
    const { calls } = use({
      "GET /api/v1/projects": {
        body: { items: rows, total: 25, page: 1, pageSize: 25, pageCount: 1 },
      },
    });
    const result = await searchProjectsAction({ q: "proyecto" });
    expect(result.ok && result.data).toHaveLength(20);
    expect(result.ok && result.data[0]).toEqual({
      type: "PROJECT",
      id: "pry_0",
      code: "PRY-0000",
      label: "Proyecto 0",
    });
    expect(calls[0]?.search.get("q")).toBe("proyecto");
    expect(calls[0]?.search.get("sort")).toBe("code:desc");
  });

  it("rejects an over-long query with VALIDATION before calling the BE", async () => {
    const { calls } = use({});
    expect(await searchProjectsAction({ q: "x".repeat(201) })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    expect(calls).toHaveLength(0);
  });

  it("keeps the frozen signature: { q } in, ActionResult<EntityRef[]> out (DT-218)", () => {
    expectTypeOf(searchProjectsAction).parameter(0).toExtend<{ q?: string }>();
    expectTypeOf(searchProjectsAction).returns.resolves.toEqualTypeOf<ActionResult<EntityRef[]>>();
  });
});

describe("exportProjectsCsvAction", () => {
  /** Routes the server client of the export action to an HTTP double of `POST /exports/PROJECT`. */
  function exportApi(response?: () => Response) {
    const mocked = mockApi({
      "POST /api/v1/exports/PROJECT":
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

  const payload = (query: object = {}, columns = ["code", "name", "contractedValueUsd"]) => ({
    entity: "PROJECT" as const,
    query,
    columns,
  });

  it("posts the technology facet and the translated columns to /exports/PROJECT", async () => {
    as("MEMBER");
    const { calls } = exportApi();
    const result = await exportProjectsCsvAction(
      payload({ filters: { technologyId: ["tec_next_js"] } }),
    );
    expect(result).toMatchObject({ ok: true, data: { rowCount: 2 } });
    expect(calls[0]?.body).toEqual({
      columns: [
        { id: "code", label: "projects:columns.code" },
        { id: "name", label: "projects:columns.name" },
        { id: "contractedValueUsd", label: "projects:columns.contractedValueUsd" },
      ],
      query: { archived: "exclude", filters: { technologyId: "tec_next_js" } },
    });
  });

  it("splits the delivery window into deliveryFrom / deliveryTo and maps the BE error", async () => {
    as("OWNER");
    const { calls } = exportApi();
    await exportProjectsCsvAction(
      payload({ filters: { delivery: ["2026-10-01", "2026-10-31"] } }, ["code", "targetEndDate"]),
    );
    expect(calls[0]?.body).toMatchObject({
      query: { filters: { deliveryFrom: "2026-10-01", deliveryTo: "2026-10-31" } },
    });

    exportApi(errorResponse("FORBIDDEN"));
    expect(await exportProjectsCsvAction(payload())).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    expect(await exportProjectsCsvAction(payload({}, []))).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("listProjectsAction", () => {
  it("reads the filtered page through GET /projects", async () => {
    const { calls } = use({
      "GET /api/v1/projects": {
        body: { items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 },
      },
    });
    expect(await listProjectsAction({ page: 1, pageSize: 25, q: "tamanaco" })).toMatchObject({
      ok: true,
      data: { total: 0 },
    });
    expect(calls[0]?.search.get("q")).toBe("tamanaco");
  });

  it("refuses an unauthenticated caller with UNAUTHENTICATED", async () => {
    use({ "GET /api/v1/projects": errorEnvelope("UNAUTHENTICATED") });
    expect(await listProjectsAction({ page: 1, pageSize: 25 })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
  });

  it("answers a malformed filter with VALIDATION", async () => {
    expect(await listProjectsAction({ page: 0 })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});
