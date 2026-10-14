// MOCK — tests for the document category and type services (HU-21, PRD §8.9.1).
import { describe, expect, it } from "vitest";
import {
  createDocumentCategoryInputSchema,
  createDocumentTypeInputSchema,
  documentTypeFilterSchema,
  updateDocumentTypeInputSchema,
  type DocumentTypesService,
} from "@/lib/validators/document-types";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import {
  createDocumentCategory,
  createDocumentType,
  deleteDocumentCategory,
  deleteDocumentType,
  getDocumentType,
  listDocumentCategories,
  listDocumentTypes,
  reorderDocumentCategories,
  setDocumentTypeActive,
  updateDocumentCategory,
  updateDocumentType,
} from "./document-types";

// Compile-time check: the mock implements the contract (C8, C9).
export const documentTypesContract = {
  createDocumentCategory,
  updateDocumentCategory,
  reorderDocumentCategories,
  deleteDocumentCategory,
  listDocumentCategories,
  createDocumentType,
  updateDocumentType,
  setDocumentTypeActive,
  deleteDocumentType,
  listDocumentTypes,
  getDocumentType,
} satisfies DocumentTypesService<MockServiceContext>;

const settingsEntries = (db: MockServiceContext["db"]) =>
  db.activity.filter((entry) => entry.action === "SETTINGS_CHANGE");

/** A type no document points at, archived ones included. */
function unusedTypeId(db: MockServiceContext["db"]): string {
  const type = db.documentTypes.find((row) => !db.documents.some((doc) => doc.typeId === row.id));
  if (!type) throw new Error("fixture: every type is in use");
  return type.id;
}

describe("document categories", () => {
  it("creates a category after the last one and logs it", async () => {
    const { ctx, db } = makeTestContext();
    const before = settingsEntries(db).length;
    const created = await createDocumentCategory(
      ctx,
      createDocumentCategoryInputSchema.parse({ name: "Recursos humanos", nameEn: "HR" }),
    );
    expect(created).toMatchObject({
      name: "Recursos humanos",
      nameEn: "HR",
      color: null,
      order: 5,
      types: [],
    });
    const categories = await listDocumentCategories(ctx);
    expect(categories.at(-1)?.id).toBe(created.id);
    expect(settingsEntries(db)).toHaveLength(before + 1);
  });

  it("refuses a category name already taken (case-insensitive)", async () => {
    const { ctx } = makeTestContext();
    await expect(
      createDocumentCategory(ctx, createDocumentCategoryInputSchema.parse({ name: "legal" })),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { name: ["catalogs.documentTypes.errors.categoryNameTaken"] },
    });
  });

  it("updates name, English name and colour, keeping the order and the types", async () => {
    const { ctx, db } = makeTestContext();
    const legal = db.documentCategories.find((row) => row.name === "Legal")!;
    const updated = await updateDocumentCategory(ctx, {
      id: legal.id,
      name: "Jurídico",
      nameEn: undefined,
      color: "#112233",
    });
    expect(updated).toMatchObject({ name: "Jurídico", nameEn: null, color: "#112233", order: 0 });
    expect(updated.types.length).toBeGreaterThan(0);
    await expect(
      updateDocumentCategory(ctx, { id: "dcat_missing", name: "X", nameEn: undefined }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("reorders every category and refuses a list that is not the full set", async () => {
    const { ctx, db } = makeTestContext();
    const ids = (await listDocumentCategories(ctx)).map((row) => row.id);
    const reversed = [...ids].reverse();
    const result = await reorderDocumentCategories(ctx, { orderedIds: reversed });
    expect(result.map((row) => row.id)).toEqual(reversed);
    expect(result.map((row) => row.order)).toEqual([0, 1, 2, 3, 4]);
    expect((await listDocumentCategories(ctx)).map((row) => row.id)).toEqual(reversed);
    expect(settingsEntries(db).at(-1)?.changes).toBeDefined();

    await expect(
      reorderDocumentCategories(ctx, { orderedIds: ids.slice(1) }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { orderedIds: ["catalogs.documentTypes.errors.reorderMismatch"] },
    });
  });

  it("deletes an empty category and renumbers the rest", async () => {
    const { ctx, db } = makeTestContext();
    const created = await createDocumentCategory(
      ctx,
      createDocumentCategoryInputSchema.parse({ name: "Temporal" }),
    );
    await expect(deleteDocumentCategory(ctx, { id: created.id })).resolves.toEqual({
      id: created.id,
    });
    expect(db.documentCategories.some((row) => row.id === created.id)).toBe(false);
    expect((await listDocumentCategories(ctx)).map((row) => row.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("locks the delete of a category that has types (INTEGRITY_LOCK)", async () => {
    const { ctx, db } = makeTestContext();
    const legal = db.documentCategories.find((row) => row.name === "Legal")!;
    await expect(deleteDocumentCategory(ctx, { id: legal.id })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
      message: "catalogs.documentTypes.errors.categoryHasTypes",
    });
    expect(db.documentCategories.some((row) => row.id === legal.id)).toBe(true);
  });
});

describe("document types", () => {
  it("creates a type inside a category with its capabilities (HU-21 CA1)", async () => {
    const { ctx, db } = makeTestContext();
    const legal = db.documentCategories.find((row) => row.name === "Legal")!;
    const created = await createDocumentType(
      ctx,
      createDocumentTypeInputSchema.parse({
        categoryId: legal.id,
        name: "Poder notarial",
        requiresSignature: true,
        hasExpiration: true,
        defaultFormat: "MARKDOWN",
      }),
    );
    expect(created).toMatchObject({
      name: "Poder notarial",
      nameEn: null,
      requiresSignature: true,
      hasExpiration: true,
      defaultFormat: "MARKDOWN",
      active: true,
      documentCount: 0,
      category: { id: legal.id, name: "Legal" },
    });
    // Available at once in the active picker list.
    const active = await listDocumentTypes(
      ctx,
      documentTypeFilterSchema.parse({ active: true, pageSize: 100 }),
    );
    expect(active.items.some((row) => row.id === created.id)).toBe(true);
  });

  it("refuses an unknown category and a name taken inside the same category", async () => {
    const { ctx, db } = makeTestContext();
    await expect(
      createDocumentType(
        ctx,
        createDocumentTypeInputSchema.parse({ categoryId: "dcat_missing", name: "X" }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      fieldErrors: { categoryId: ["catalogs.documentTypes.errors.unknownCategory"] },
    });
    const nda = db.documentTypes.find((row) => row.name.startsWith("Adenda"))!;
    await expect(
      createDocumentType(
        ctx,
        createDocumentTypeInputSchema.parse({ categoryId: nda.categoryId, name: "adenda" }),
      ),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      fieldErrors: { name: ["catalogs.documentTypes.errors.typeNameTaken"] },
    });
  });

  it("updates every field, moving the type to another category, and logs the diff", async () => {
    const { ctx, db } = makeTestContext();
    const type = db.documentTypes.find((row) => row.name === "Adenda")!;
    const tecnico = db.documentCategories.find((row) => row.name === "Técnico")!;
    const updated = await updateDocumentType(
      ctx,
      updateDocumentTypeInputSchema.parse({
        id: type.id,
        categoryId: tecnico.id,
        name: "Adenda técnica",
        nameEn: "Technical addendum",
        requiresSignature: false,
        hasExpiration: true,
        defaultFormat: "ENLACE",
        active: true,
      }),
    );
    expect(updated).toMatchObject({
      name: "Adenda técnica",
      nameEn: "Technical addendum",
      requiresSignature: false,
      hasExpiration: true,
      defaultFormat: "ENLACE",
      category: { id: tecnico.id },
    });
    expect(settingsEntries(db).at(-1)?.changes).toMatchObject({
      name: ["Adenda", "Adenda técnica"],
      requiresSignature: [true, false],
    });
  });

  it("deactivates and reactivates a type", async () => {
    const { ctx, db } = makeTestContext();
    const type = db.documentTypes[0]!;
    await expect(setDocumentTypeActive(ctx, { id: type.id, active: false })).resolves.toMatchObject(
      { id: type.id, active: false },
    );
    const inactive = await listDocumentTypes(
      ctx,
      documentTypeFilterSchema.parse({ active: false, pageSize: 100 }),
    );
    expect(inactive.items.map((row) => row.id)).toEqual([type.id]);
    await expect(setDocumentTypeActive(ctx, { id: type.id, active: true })).resolves.toMatchObject({
      active: true,
    });
  });

  it("deletes an unused type and returns NOT_FOUND for it afterwards", async () => {
    const { ctx, db } = makeTestContext();
    const id = unusedTypeId(db);
    await expect(deleteDocumentType(ctx, { id })).resolves.toEqual({ id });
    await expect(getDocumentType(ctx, { id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("locks the delete of a type in use, even by archived documents (HU-21 CA2)", async () => {
    const { ctx, db } = makeTestContext();
    const doc = db.documents.find((row) => !row.archivedAt)!;
    await expect(deleteDocumentType(ctx, { id: doc.typeId })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
      message: "catalogs.documentTypes.errors.typeInUse",
    });
    // Archived documents still point at the type.
    for (const row of db.documents) {
      if (row.typeId === doc.typeId) row.archivedAt = "2026-10-01T00:00:00.000Z";
    }
    expect((await getDocumentType(ctx, { id: doc.typeId })).documentCount).toBe(0);
    await expect(deleteDocumentType(ctx, { id: doc.typeId })).rejects.toMatchObject({
      code: "INTEGRITY_LOCK",
    });
    // The way out is deactivation.
    await expect(
      setDocumentTypeActive(ctx, { id: doc.typeId, active: false }),
    ).resolves.toMatchObject({ active: false });
  });

  it("reads one type with its category and document count", async () => {
    const { ctx, db } = makeTestContext();
    const doc = db.documents.find((row) => !row.archivedAt)!;
    const type = await getDocumentType(ctx, { id: doc.typeId });
    expect(type.documentCount).toBeGreaterThanOrEqual(1);
    expect(type.category.id).toBe(
      db.documentTypes.find((row) => row.id === doc.typeId)?.categoryId,
    );
  });
});
