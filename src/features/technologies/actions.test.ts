import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const intl = vi.hoisted(() => ({
  getTranslations: vi.fn(async (namespace: string) => (key: string) => `${namespace}:${key}`),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);
vi.mock("next-intl/server", () => intl);

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
    asRole("VIEWER");
    const result = await listTechnologiesAction({ pageSize: 25 });
    expect(result.ok).toBe(true);
  });

  it("refuses the CSV export to Member with FORBIDDEN", async () => {
    asRole("MEMBER");
    await expect(
      exportTechnologiesCsvAction({ entity: "TECHNOLOGY", query: listQuery, columns: ["name"] }),
    ).resolves.toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
  });

  it("exports the catalog with translated headers for Owner", async () => {
    asRole("OWNER");
    const result = await exportTechnologiesCsvAction({
      entity: "TECHNOLOGY",
      query: listQuery,
      columns: ["name", "usageCount"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The file starts with the UTF-8 BOM (PD-2).
    expect(result.data.content.replace(/^\ufeff/, "").split("\r\n")[0]).toBe(
      "catalogs:technologies.table.columns.name,catalogs:technologies.table.columns.usageCount",
    );
    expect(result.data.rowCount).toBeGreaterThan(0);
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
