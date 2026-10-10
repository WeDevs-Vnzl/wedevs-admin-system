import { describe, expect, it } from "vitest";
import {
  createDocumentCategoryInputSchema,
  createDocumentTypeInputSchema,
  documentCategoryDetailSchema,
  documentTypeDetailSchema,
  documentTypeFilterSchema,
  reorderDocumentCategoriesInputSchema,
  setDocumentTypeActiveInputSchema,
  updateDocumentTypeInputSchema,
} from "./document-types";

describe("document categories", () => {
  it("accept name with optional nameEn and colour", () => {
    expect(createDocumentCategoryInputSchema.safeParse({ name: "Legal" }).success).toBe(true);
    expect(
      createDocumentCategoryInputSchema.safeParse({
        name: "Legal",
        nameEn: "Legal",
        color: "#336699",
      }).success,
    ).toBe(true);
    expect(createDocumentCategoryInputSchema.safeParse({ name: " " }).success).toBe(false);
    expect(
      createDocumentCategoryInputSchema.safeParse({ name: "Legal", color: "blue" }).success,
    ).toBe(false);
  });

  it("reorder takes every id once, in order", () => {
    expect(reorderDocumentCategoriesInputSchema.safeParse({ orderedIds: ["a", "b"] }).success).toBe(
      true,
    );
    expect(reorderDocumentCategoriesInputSchema.safeParse({ orderedIds: ["a", "a"] }).success).toBe(
      false,
    );
    expect(reorderDocumentCategoriesInputSchema.safeParse({ orderedIds: [] }).success).toBe(false);
  });
});

describe("document types", () => {
  const valid = { categoryId: "cat_legal", name: "Contrato de servicios" };

  it("defaults: no signature, no expiration, ARCHIVO, active", () => {
    expect(createDocumentTypeInputSchema.parse(valid)).toEqual({
      ...valid,
      nameEn: undefined,
      requiresSignature: false,
      hasExpiration: false,
      defaultFormat: "ARCHIVO",
      active: true,
    });
  });

  it("accepts the capability flags, an English name and every format", () => {
    for (const defaultFormat of ["MARKDOWN", "ARCHIVO", "ENLACE"]) {
      expect(
        createDocumentTypeInputSchema.safeParse({
          ...valid,
          nameEn: "Services agreement",
          requiresSignature: true,
          hasExpiration: true,
          defaultFormat,
        }).success,
      ).toBe(true);
    }
  });

  it("rejects missing category, blank name and unknown format", () => {
    expect(createDocumentTypeInputSchema.safeParse({ name: "X" }).success).toBe(false);
    expect(createDocumentTypeInputSchema.safeParse({ ...valid, name: "" }).success).toBe(false);
    expect(
      createDocumentTypeInputSchema.safeParse({ ...valid, defaultFormat: "PDF" }).success,
    ).toBe(false);
  });

  it("update, deactivate and filter", () => {
    expect(updateDocumentTypeInputSchema.safeParse({ id: "t1", ...valid }).success).toBe(true);
    expect(setDocumentTypeActiveInputSchema.safeParse({ id: "t1", active: false }).success).toBe(
      true,
    );
    const parsed = documentTypeFilterSchema.parse({
      categoryId: "cat_legal",
      requiresSignature: "true",
    });
    expect(parsed.categoryId).toEqual(["cat_legal"]);
    expect(parsed.requiresSignature).toBe(true);
    expect(documentTypeFilterSchema.safeParse({ sort: "id:asc" }).success).toBe(false);
  });

  it("DTOs carry the capabilities the document form needs", () => {
    const category = { id: "cat_legal", name: "Legal", nameEn: null, color: null };
    const type = {
      id: "t1",
      name: "NDA",
      nameEn: null,
      requiresSignature: true,
      hasExpiration: true,
      defaultFormat: "ARCHIVO",
      active: true,
      documentCount: 2,
    };
    expect(documentTypeDetailSchema.safeParse({ ...type, category }).success).toBe(true);
    expect(
      documentCategoryDetailSchema.safeParse({ ...category, order: 0, types: [type] }).success,
    ).toBe(true);
  });
});
