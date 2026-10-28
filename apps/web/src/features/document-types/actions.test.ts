import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/mocks/session", () => session);

import { makeSessionUser } from "@/mocks/test-helpers";
import {
  createDocumentCategoryAction,
  createDocumentTypeAction,
  deleteDocumentCategoryAction,
  deleteDocumentTypeAction,
  reorderDocumentCategoriesAction,
  setDocumentTypeActiveAction,
  updateDocumentCategoryAction,
  updateDocumentTypeAction,
} from "./actions";

function asRole(role: "OWNER" | "ADMIN" | "MEMBER" | "VIEWER") {
  session.getMockSessionUser.mockResolvedValue(makeSessionUser(role));
}

beforeEach(() => {
  session.getMockSessionUser.mockReset();
});

const forbidden = { ok: false, error: { code: "FORBIDDEN" } };

describe("document type actions: permissions (settings row)", () => {
  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses every write to %s with FORBIDDEN",
    async (role) => {
      asRole(role);
      const id = "dtyp_x";
      const results = await Promise.all([
        createDocumentCategoryAction({ name: "Nueva" }),
        updateDocumentCategoryAction({ id: "dcat_x", name: "Nueva" }),
        reorderDocumentCategoriesAction({ orderedIds: ["dcat_x"] }),
        deleteDocumentCategoryAction({ id: "dcat_x" }),
        createDocumentTypeAction({ categoryId: "dcat_x", name: "Nuevo" }),
        updateDocumentTypeAction({ id, categoryId: "dcat_x", name: "Nuevo" }),
        setDocumentTypeActiveAction({ id, active: false }),
        deleteDocumentTypeAction({ id }),
      ]);
      for (const result of results) expect(result).toMatchObject(forbidden);
    },
  );

  it("lets Admin create a category and a type inside it", async () => {
    asRole("ADMIN");
    const category = await createDocumentCategoryAction({ name: "Recursos humanos" });
    expect(category).toMatchObject({ ok: true, data: { name: "Recursos humanos", types: [] } });
    if (!category.ok) return;
    const type = await createDocumentTypeAction({
      categoryId: category.data.id,
      name: "Contrato laboral",
      requiresSignature: true,
    });
    expect(type).toMatchObject({
      ok: true,
      data: { name: "Contrato laboral", requiresSignature: true, defaultFormat: "ARCHIVO" },
    });
  });
});

describe("deleteDocumentTypeAction: in-use lock (HU-21 CA2)", () => {
  it("answers INTEGRITY_LOCK for a type that documents use", async () => {
    asRole("OWNER");
    await expect(
      deleteDocumentTypeAction({ id: "dtyp_contrato_servicios" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.documentTypes.errors.typeInUse" },
    });
  });

  it("answers INTEGRITY_LOCK for a category that has types", async () => {
    asRole("OWNER");
    await expect(deleteDocumentCategoryAction({ id: "dcat_legal" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.documentTypes.errors.categoryHasTypes" },
    });
  });
});
