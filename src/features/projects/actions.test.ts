import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: string) => (key: string) => `${namespace}:${key}`,
}));

import type { UserRole } from "@/lib/validators/enums";
import { getMockStore } from "@/mocks/store";
import { makeSessionUser } from "@/mocks/test-helpers";
import {
  archiveProjectAction,
  archiveProjectsAction,
  createProjectAction,
  exportProjectsCsvAction,
  removeProjectLinkAction,
  reorderProjectLinksAction,
  searchProjectsAction,
  setProjectClientsAction,
  setProjectStatusAction,
  setProjectTechnologiesAction,
  updateProjectAction,
  upsertProjectLinksAction,
} from "./actions";

const as = (role: UserRole) => session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));

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
});

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__wedevsMockState;
});

describe("createProjectAction", () => {
  it("creates the project, logs the activity and revalidates the project paths", async () => {
    as("ADMIN");
    const result = await createProjectAction(newProject);
    expect(result).toMatchObject({
      ok: true,
      data: { status: "PROPUESTA", name: "Sitio de prueba" },
    });
    expect(getMockStore().projects.some((p) => p.name === "Sitio de prueba")).toBe(true);
    expect(cache.revalidatePath).toHaveBeenCalledWith("/projects", "layout");
    expect(cache.revalidatePath).toHaveBeenCalledWith("/clients", "layout");
  });

  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses a %s with FORBIDDEN and writes nothing",
    async (role) => {
      as(role);
      const count = getMockStore().projects.length;
      expect(await createProjectAction(newProject)).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(getMockStore().projects).toHaveLength(count);
      expect(cache.revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("answers VALIDATION with field errors for a bad input and for a service rule", async () => {
    as("OWNER");
    expect(await createProjectAction({ ...newProject, clients: [] })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { clients: expect.any(Array) } },
    });
    expect(await createProjectAction({ ...newProject, technologyIds: ["tec_nope"] })).toMatchObject(
      {
        ok: false,
        error: {
          code: "VALIDATION",
          fieldErrors: { technologyIds: ["projects.errors.technologyUnknown"] },
        },
      },
    );
  });
});

describe("updateProjectAction and the other update grants", () => {
  it("lets a Member update (RU on projects, PRD §4.3)", async () => {
    as("MEMBER");
    expect(await updateProjectAction(edit)).toMatchObject({
      ok: true,
      data: { name: "Sitio web Kairos renovado" },
    });
  });

  it("lets a Member change the status, the clients, the stack and the links", async () => {
    as("MEMBER");
    expect(await setProjectStatusAction({ id: "pry_kairos_web", status: "PAUSADO" })).toMatchObject(
      { ok: true, data: { project: { status: "PAUSADO" }, hints: [] } },
    );
    expect(
      await setProjectClientsAction({
        projectId: "pry_kairos_web",
        clients: [{ clientId: "cli_kairos" }],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await setProjectTechnologiesAction({
        projectId: "pry_kairos_web",
        technologyIds: ["tec_react"],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await upsertProjectLinksAction({
        projectId: "pry_kairos_web",
        links: [{ group: "OTRO", label: "Wiki", url: "https://wiki.example.com" }],
      }),
    ).toMatchObject({ ok: true });
    const [first, second] = getMockStore()
      .projects.find((p) => p.id === "pry_kairos_web")!
      .links.filter((l) => l.group === "REPOSITORIO");
    expect(
      await reorderProjectLinksAction({
        projectId: "pry_kairos_web",
        group: "REPOSITORIO",
        orderedLinkIds: [second!.id, first!.id],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await removeProjectLinkAction({ projectId: "pry_kairos_web", linkId: first!.id }),
    ).toMatchObject({ ok: true });
  });

  it("refuses a Viewer on every update action", async () => {
    as("VIEWER");
    const forbidden = { ok: false, error: { code: "FORBIDDEN" } };
    expect(await updateProjectAction(edit)).toMatchObject(forbidden);
    expect(await setProjectStatusAction({ id: "pry_kairos_web", status: "PAUSADO" })).toMatchObject(
      forbidden,
    );
    expect(
      await setProjectTechnologiesAction({ projectId: "pry_kairos_web", technologyIds: [] }),
    ).toMatchObject(forbidden);
    expect(getMockStore().projects.find((p) => p.id === "pry_kairos_web")!.status).toBe("EN_CURSO");
  });

  it("maps a refused transition and a missing date to VALIDATION", async () => {
    as("OWNER");
    expect(
      await setProjectStatusAction({ id: "pry_kairos_web", status: "MANTENIMIENTO" }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { status: ["projects.errors.invalidTransition"] } },
    });
    expect(
      await setProjectStatusAction({ id: "pry_orinoco_tracking", status: "EN_CURSO" }),
    ).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", fieldErrors: { startDate: expect.any(Array) } },
    });
    expect(await updateProjectAction({ ...edit, id: "pry_nope" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
  });
});

describe("archive actions", () => {
  it("lets Owner and Admin archive and refuses a Member and a Viewer", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      as(role);
      expect(await archiveProjectAction({ id: "pry_tornillo_tienda" })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(await archiveProjectsAction({ ids: ["pry_tornillo_tienda"] })).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
    }
    expect(
      getMockStore().projects.find((p) => p.id === "pry_tornillo_tienda")!.archivedAt,
    ).toBeNull();
    as("ADMIN");
    expect(await archiveProjectAction({ id: "pry_tornillo_tienda" })).toMatchObject({
      ok: true,
      data: { id: "pry_tornillo_tienda" },
    });
    as("OWNER");
    expect(
      await archiveProjectsAction({ ids: ["pry_aurora_pos", "pry_espiga_web"] }),
    ).toMatchObject({
      ok: true,
      data: { archived: [{ id: "pry_aurora_pos" }, { id: "pry_espiga_web" }] },
    });
  });
});

describe("searchProjectsAction", () => {
  it("returns at most 20 project refs matching q, for any role that can read", async () => {
    as("VIEWER");
    const all = await searchProjectsAction({ q: "" });
    expect(all).toMatchObject({ ok: true });
    if (all.ok) {
      expect(all.data.length).toBeLessThanOrEqual(20);
      expect(all.data[0]).toMatchObject({ type: "PROJECT" });
    }
    const found = await searchProjectsAction({ q: "tamanaco" });
    expect(found).toMatchObject({
      ok: true,
      data: [
        {
          id: "pry_tamanaco_erp",
          code: expect.stringMatching(/^PRY-/),
          label: "ERP financiero Tamanaco",
        },
      ],
    });
  });

  it("rejects an over-long query with VALIDATION", async () => {
    as("MEMBER");
    expect(await searchProjectsAction({ q: "x".repeat(201) })).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
  });
});

describe("exportProjectsCsvAction", () => {
  const payload = (query: object = {}, columns = ["code", "name", "contractedValueUsd"]) => ({
    entity: "PROJECT" as const,
    query,
    columns,
  });

  it("exports the filtered rows with translated headers; technologyId is a facet", async () => {
    as("MEMBER");
    const result = await exportProjectsCsvAction(
      payload({ filters: { technologyId: ["tec_next_js"] } }),
    );
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    const expected = getMockStore().projects.filter(
      (p) => !p.archivedAt && p.technologyIds.includes("tec_next_js"),
    );
    expect(result.data.rowCount).toBe(expected.length);
    const [header, ...rows] = result.data.content.replace(/^﻿/, "").trim().split("\r\n");
    expect(header).toBe(
      "projects:columns.code,projects:columns.name,projects:columns.contractedValueUsd",
    );
    expect(rows).toHaveLength(expected.length);
    expect(rows.every((row) => row.endsWith("0.00"))).toBe(true);
  });

  it("applies the delivery window facet and refuses unknown columns and non-readers", async () => {
    as("OWNER");
    const windowed = await exportProjectsCsvAction(
      payload({ filters: { delivery: ["2026-10-10", "2026-10-30"] } }, [
        "code",
        "targetEndDate",
        "stack",
      ]),
    );
    expect(windowed).toMatchObject({ ok: true });
    if (windowed.ok) {
      expect(windowed.data.content).toContain("PRY-");
      expect(windowed.data.rowCount).toBeGreaterThan(0);
    }
    expect(await exportProjectsCsvAction(payload({}, ["code", "nope"]))).toMatchObject({
      ok: false,
      error: { code: "VALIDATION" },
    });
    session.getMockSessionUser.mockResolvedValue(null);
    expect(await exportProjectsCsvAction(payload())).toMatchObject({ ok: false });
  });
});
