import { beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));
const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);
vi.mock("@/mocks/session", () => session);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
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
  cache.revalidatePath.mockReset();
  cache.updateTag.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const category = {
  id: "dcat_rrhh",
  name: "Recursos humanos",
  nameEn: null,
  color: null,
  order: 3,
  types: [],
};

const forbidden = { ok: false, error: { code: "FORBIDDEN" } };

describe("document category writes through the API (settings grant)", () => {
  it("creates a category at the end through POST /api/v1/document-categories", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/document-categories": { status: 201, body: category },
    });
    server.getServerApi.mockResolvedValue(api);

    expect(await createDocumentCategoryAction({ name: "Recursos humanos" })).toEqual({
      ok: true,
      data: category,
    });
    expect(calls[0]?.body).toEqual({ name: "Recursos humanos" });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/document-types");
  });

  it("renames through PATCH /api/v1/document-categories/{id} without the id in the body", async () => {
    const { api, calls } = mockApi({
      "PATCH /api/v1/document-categories/{id}": { body: { ...category, name: "Talento" } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      updateDocumentCategoryAction({ id: "dcat_rrhh", name: "Talento" }),
    ).resolves.toMatchObject({ ok: true, data: { name: "Talento" } });
    expect(calls[0]?.path).toBe("/api/v1/document-categories/dcat_rrhh");
    expect(calls[0]?.body).toEqual({ name: "Talento" });
  });

  it("reorders with the full id set through POST /api/v1/document-categories/reorder", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/document-categories/reorder": { body: [category] },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      reorderDocumentCategoriesAction({ orderedIds: ["dcat_rrhh", "dcat_legal"] }),
    ).resolves.toEqual({ ok: true, data: [category] });
    expect(calls[0]?.body).toEqual({ orderedIds: ["dcat_rrhh", "dcat_legal"] });
  });

  it("answers VALIDATION with the field key when the reorder misses a category (422)", async () => {
    const { api } = mockApi({
      "POST /api/v1/document-categories/reorder": errorEnvelope("VALIDATION", {
        fieldErrors: { orderedIds: ["catalogs.documentTypes.errors.reorderMismatch"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      reorderDocumentCategoriesAction({ orderedIds: ["dcat_rrhh"] }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { orderedIds: ["catalogs.documentTypes.errors.reorderMismatch"] },
      },
    });
  });

  it("deletes an empty category through DELETE /api/v1/document-categories/{id}", async () => {
    const { api, calls } = mockApi({
      "DELETE /api/v1/document-categories/{id}": { body: { id: "dcat_rrhh" } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(deleteDocumentCategoryAction({ id: "dcat_rrhh" })).resolves.toEqual({
      ok: true,
      data: { id: "dcat_rrhh" },
    });
    expect(calls[0]?.method).toBe("DELETE");
  });

  it("answers INTEGRITY_LOCK (409) for a category that still has types", async () => {
    const { api } = mockApi({
      "DELETE /api/v1/document-categories/{id}": errorEnvelope("INTEGRITY_LOCK", {
        message: "catalogs.documentTypes.errors.categoryHasTypes",
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(deleteDocumentCategoryAction({ id: "dcat_legal" })).resolves.toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.documentTypes.errors.categoryHasTypes" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses every category write to Member and Viewer with FORBIDDEN from the BE", async () => {
    const { api } = mockApi({
      "POST /api/v1/document-categories": errorEnvelope("FORBIDDEN"),
      "PATCH /api/v1/document-categories/{id}": errorEnvelope("FORBIDDEN"),
      "POST /api/v1/document-categories/reorder": errorEnvelope("FORBIDDEN"),
      "DELETE /api/v1/document-categories/{id}": errorEnvelope("FORBIDDEN"),
    });
    server.getServerApi.mockResolvedValue(api);

    const results = await Promise.all([
      createDocumentCategoryAction({ name: "Nueva" }),
      updateDocumentCategoryAction({ id: "dcat_x", name: "Nueva" }),
      reorderDocumentCategoriesAction({ orderedIds: ["dcat_x"] }),
      deleteDocumentCategoryAction({ id: "dcat_x" }),
    ]);
    for (const result of results) expect(result).toMatchObject(forbidden);
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });
});

// Document type writes still run on the mock seam until their own unit moves them to the API.
describe("document type actions: permissions (settings row)", () => {
  it.each(["MEMBER", "VIEWER"] as const)(
    "refuses every type write to %s with FORBIDDEN",
    async (role) => {
      asRole(role);
      const id = "dtyp_x";
      const results = await Promise.all([
        updateDocumentTypeAction({ id, categoryId: "dcat_x", name: "Nuevo" }),
        setDocumentTypeActiveAction({ id, active: false }),
        deleteDocumentTypeAction({ id }),
        createDocumentTypeAction({ categoryId: "dcat_x", name: "Nuevo" }),
      ]);
      for (const result of results) expect(result).toMatchObject(forbidden);
    },
  );
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
});
