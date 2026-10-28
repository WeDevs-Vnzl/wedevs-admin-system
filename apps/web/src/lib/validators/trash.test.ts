import { describe, expect, it } from "vitest";
import {
  TRASHABLE_ENTITY_TYPE_VALUES,
  archivedRecordSchema,
  restoreFromTrashInputSchema,
  restoredRecordSchema,
  trashFilterSchema,
  trashRowSchema,
} from "./trash";

describe("trash", () => {
  it("only soft-deletable entities are trashable", () => {
    expect(TRASHABLE_ENTITY_TYPE_VALUES).toContain("CLIENT");
    expect(TRASHABLE_ENTITY_TYPE_VALUES).not.toContain("USER");
    expect(TRASHABLE_ENTITY_TYPE_VALUES).not.toContain("TAG");
  });

  it("restoreFromTrash needs a trashable type and an id", () => {
    expect(
      restoreFromTrashInputSchema.safeParse({ entityType: "INVOICE", entityId: "inv_1" }).success,
    ).toBe(true);
    expect(
      restoreFromTrashInputSchema.safeParse({ entityType: "TAG", entityId: "t1" }).success,
    ).toBe(false);
    expect(restoreFromTrashInputSchema.safeParse({ entityType: "CLIENT" }).success).toBe(false);
  });

  it("trashFilter takes facets, date-only bounds and a sort whitelist", () => {
    const parsed = trashFilterSchema.parse({
      entityType: ["CLIENT", "PROJECT"],
      deletedFrom: "2026-10-01",
      sort: "deletedAt:desc",
    });
    expect(parsed.entityType).toEqual(["CLIENT", "PROJECT"]);
    expect(trashFilterSchema.safeParse({ deletedFrom: "2026-02-30" }).success).toBe(false);
    expect(trashFilterSchema.safeParse({ entityType: "USER" }).success).toBe(false);
    expect(trashFilterSchema.safeParse({ sort: "code:asc" }).success).toBe(false);
  });

  it("row, archive and restore DTOs", () => {
    const entity = { id: "cli_1", code: "CLI-0001", label: "Kairos", type: "CLIENT" };
    expect(
      trashRowSchema.safeParse({
        entity,
        context: null,
        deletedAt: "2026-10-01T10:00:00.000Z",
        deletedBy: { id: "usr_1", name: "Andrés", imageUrl: null },
      }).success,
    ).toBe(true);
    expect(
      trashRowSchema.safeParse({
        entity: { ...entity, type: "TAG" },
        context: null,
        deletedAt: "2026-10-01T10:00:00.000Z",
        deletedBy: null,
      }).success,
    ).toBe(false);
    expect(
      archivedRecordSchema.safeParse({ id: "x", archivedAt: "2026-10-01T10:00:00.000Z" }).success,
    ).toBe(true);
    expect(
      restoredRecordSchema.safeParse({ entity, restoredAt: "2026-10-01T10:00:00.000Z" }).success,
    ).toBe(true);
  });
});
