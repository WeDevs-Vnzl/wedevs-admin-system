import { describe, expect, it } from "vitest";
import {
  RESTORABLE_ENTITY_TYPE_VALUES,
  TRASHABLE_ENTITY_TYPE_VALUES,
  archivedRecordSchema,
  trashFilterSchema,
  trashRowSchema,
} from "./trash";

describe("trash", () => {
  it("only soft-deletable entities are trashable", () => {
    expect(TRASHABLE_ENTITY_TYPE_VALUES).toContain("CLIENT");
    expect(TRASHABLE_ENTITY_TYPE_VALUES).not.toContain("USER");
    expect(TRASHABLE_ENTITY_TYPE_VALUES).not.toContain("TAG");
  });

  it("the trash facets are the types the BE registers a restore handler for", () => {
    expect([...RESTORABLE_ENTITY_TYPE_VALUES].sort()).toEqual(
      ["CLIENT", "CONTACT", "DOCUMENT", "INVOICE", "NOTE", "PROJECT"].sort(),
    );
    for (const type of RESTORABLE_ENTITY_TYPE_VALUES) {
      expect(TRASHABLE_ENTITY_TYPE_VALUES).toContain(type);
    }
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

  it("row and archive DTOs", () => {
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
  });
});
