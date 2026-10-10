// MOCK — tests for the tag read services.
import { describe, expect, it } from "vitest";
import { tagFilterSchema } from "@/lib/validators/tags";
import { makeTestContext } from "../test-helpers";
import { getTag, listTags, tagUsage } from "./tags";

describe("listTags", () => {
  it("lists every catalog tag with the usage of the dataset", async () => {
    const { ctx, db } = makeTestContext();
    const page = await listTags(ctx, tagFilterSchema.parse({ pageSize: 100 }));
    expect(page.total).toBe(db.tags.length);
    expect(page.items.some((row) => row.usageCount > 0)).toBe(true);
    for (const row of page.items) expect(row.usageCount).toBe(tagUsage(db, row.id));
  });

  it("counts non-archived records only and follows renames (the chip is read from the tag row)", async () => {
    const { ctx, db } = makeTestContext();
    const tag = db.tags[0]!;
    db.clients.forEach((c) => (c.tagIds = []));
    db.contacts.forEach((c) => (c.tagIds = []));
    db.projects.forEach((c) => (c.tagIds = []));
    db.documents.forEach((c) => (c.tagIds = []));
    db.notes.forEach((c) => (c.tagIds = []));
    db.clients[0]!.tagIds = [tag.id];
    db.clients[1]!.tagIds = [tag.id];
    db.clients[1]!.archivedAt = "2026-01-01T00:00:00.000Z";
    db.projects[0]!.tagIds = [tag.id];

    const all = await listTags(ctx, tagFilterSchema.parse({ sort: "usageCount:desc" }));
    expect(all.items[0]).toMatchObject({ id: tag.id, usageCount: 2 });

    const onlyProjects = await listTags(ctx, tagFilterSchema.parse({ entityType: "PROJECT" }));
    expect(onlyProjects.items.map((row) => row.id)).toEqual([tag.id]);
    expect(onlyProjects.items[0]?.usageCount).toBe(1);

    tag.name = "Renombrada";
    expect((await getTag(ctx, { id: tag.id })).name).toBe("Renombrada");
  });

  it("filters by text", async () => {
    const { ctx } = makeTestContext();
    const found = await listTags(ctx, tagFilterSchema.parse({ q: "cliente" }));
    expect(found.items.map((t) => t.name)).toEqual(["Cliente clave"]);
  });
});

describe("getTag", () => {
  it("returns one tag with its usage count", async () => {
    const { ctx, db } = makeTestContext();
    const tag = db.tags.find((t) => t.id === "tag_cliente_clave")!;
    const dto = await getTag(ctx, { id: tag.id });
    expect(dto).toMatchObject({ id: tag.id, name: tag.name, color: tag.color });
    expect(dto.usageCount).toBe(tagUsage(db, tag.id));
    expect(dto.usageCount).toBeGreaterThan(0);
  });

  it("answers NOT_FOUND for an unknown id", async () => {
    const { ctx } = makeTestContext();
    await expect(getTag(ctx, { id: "tag_missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
