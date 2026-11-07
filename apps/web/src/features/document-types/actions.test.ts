import { beforeEach, describe, expect, it, vi } from "vitest";

const cache = vi.hoisted(() => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
const server = vi.hoisted(() => ({ getServerApi: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api/server", () => server);
vi.mock("next/cache", () => cache);

import { errorEnvelope, mockApi } from "@/lib/api/testing";
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

beforeEach(() => {
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

const contract = {
  id: "dtyp_contrato",
  name: "Contrato laboral",
  nameEn: null,
  defaultFormat: "ARCHIVO",
  requiresSignature: true,
  hasExpiration: false,
  active: true,
  documentCount: 0,
  category: { id: "dcat_rrhh", name: "Recursos humanos", nameEn: null, color: null },
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

describe("document type writes through the API (settings grant)", () => {
  it("creates a type inside its category through POST /api/v1/document-types with the schema defaults", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/document-types": { status: 201, body: contract },
    });
    server.getServerApi.mockResolvedValue(api);

    expect(
      await createDocumentTypeAction({
        categoryId: "dcat_rrhh",
        name: "Contrato laboral",
        requiresSignature: true,
      }),
    ).toEqual({ ok: true, data: contract });
    expect(calls[0]?.body).toEqual({
      categoryId: "dcat_rrhh",
      name: "Contrato laboral",
      active: true,
      defaultFormat: "ARCHIVO",
      hasExpiration: false,
      requiresSignature: true,
    });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/settings/document-types");
  });

  it("answers VALIDATION with the field key of an unknown category", async () => {
    const { api } = mockApi({
      "POST /api/v1/document-types": errorEnvelope("VALIDATION", {
        fieldErrors: { categoryId: ["catalogs.documentTypes.errors.unknownCategory"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      createDocumentTypeAction({ categoryId: "dcat_gone", name: "Nuevo" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "VALIDATION",
        fieldErrors: { categoryId: ["catalogs.documentTypes.errors.unknownCategory"] },
      },
    });
  });

  it("answers CONFLICT with the field key of a name taken inside the category", async () => {
    const { api } = mockApi({
      "POST /api/v1/document-types": errorEnvelope("CONFLICT", {
        fieldErrors: { name: ["catalogs.documentTypes.errors.typeNameTaken"] },
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      createDocumentTypeAction({ categoryId: "dcat_rrhh", name: "Contrato laboral" }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "CONFLICT",
        fieldErrors: { name: ["catalogs.documentTypes.errors.typeNameTaken"] },
      },
    });
  });

  it("replaces every field through PATCH /api/v1/document-types/{id} without the id in the body", async () => {
    const { api, calls } = mockApi({
      "PATCH /api/v1/document-types/{id}": { body: { ...contract, hasExpiration: true } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      updateDocumentTypeAction({
        id: "dtyp_contrato",
        categoryId: "dcat_rrhh",
        name: "Contrato laboral",
        requiresSignature: true,
        hasExpiration: true,
        defaultFormat: "ARCHIVO",
        active: true,
      }),
    ).resolves.toMatchObject({ ok: true, data: { hasExpiration: true } });
    expect(calls[0]?.path).toBe("/api/v1/document-types/dtyp_contrato");
    expect(calls[0]?.body).toEqual({
      categoryId: "dcat_rrhh",
      name: "Contrato laboral",
      active: true,
      defaultFormat: "ARCHIVO",
      hasExpiration: true,
      requiresSignature: true,
    });
  });

  it("activates and deactivates through POST /api/v1/document-types/{id}/active", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/document-types/{id}/active": { body: { ...contract, active: false } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      setDocumentTypeActiveAction({ id: "dtyp_contrato", active: false }),
    ).resolves.toMatchObject({
      ok: true,
      data: { active: false },
    });
    expect(calls[0]?.path).toBe("/api/v1/document-types/dtyp_contrato/active");
    expect(calls[0]?.body).toEqual({ active: false });
  });

  it("deletes an unused type through DELETE /api/v1/document-types/{id}", async () => {
    const { api } = mockApi({
      "DELETE /api/v1/document-types/{id}": { body: { id: "dtyp_contrato" } },
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(deleteDocumentTypeAction({ id: "dtyp_contrato" })).resolves.toEqual({
      ok: true,
      data: { id: "dtyp_contrato" },
    });
  });

  it("answers INTEGRITY_LOCK for a type that documents use (HU-21 CA2)", async () => {
    const { api } = mockApi({
      "DELETE /api/v1/document-types/{id}": errorEnvelope("INTEGRITY_LOCK", {
        message: "catalogs.documentTypes.errors.typeInUse",
      }),
    });
    server.getServerApi.mockResolvedValue(api);

    await expect(
      deleteDocumentTypeAction({ id: "dtyp_contrato_servicios" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.documentTypes.errors.typeInUse" },
    });
    expect(cache.revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses every type write to Member and Viewer with FORBIDDEN from the BE", async () => {
    const { api } = mockApi({
      "POST /api/v1/document-types": errorEnvelope("FORBIDDEN"),
      "PATCH /api/v1/document-types/{id}": errorEnvelope("FORBIDDEN"),
      "POST /api/v1/document-types/{id}/active": errorEnvelope("FORBIDDEN"),
      "DELETE /api/v1/document-types/{id}": errorEnvelope("FORBIDDEN"),
    });
    server.getServerApi.mockResolvedValue(api);

    const results = await Promise.all([
      createDocumentTypeAction({ categoryId: "dcat_x", name: "Nuevo" }),
      updateDocumentTypeAction({ id: "dtyp_x", categoryId: "dcat_x", name: "Nuevo" }),
      setDocumentTypeActiveAction({ id: "dtyp_x", active: false }),
      deleteDocumentTypeAction({ id: "dtyp_x" }),
    ]);
    for (const result of results) expect(result).toMatchObject(forbidden);
  });

  it("lets Admin create a category and a type inside it", async () => {
    const { api } = mockApi({
      "POST /api/v1/document-categories": { status: 201, body: category },
      "POST /api/v1/document-types": {
        status: 201,
        body: {
          ...contract,
          category: { id: "dcat_rrhh", name: "Recursos humanos", nameEn: null, color: null },
        },
      },
    });
    server.getServerApi.mockResolvedValue(api);

    const created = await createDocumentCategoryAction({ name: "Recursos humanos" });
    expect(created).toMatchObject({ ok: true, data: { name: "Recursos humanos", types: [] } });
    if (!created.ok) return;
    await expect(
      createDocumentTypeAction({
        categoryId: created.data.id,
        name: "Contrato laboral",
        requiresSignature: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { name: "Contrato laboral", requiresSignature: true, defaultFormat: "ARCHIVO" },
    });
  });
});
