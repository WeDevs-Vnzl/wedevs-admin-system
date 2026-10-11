// MOCK — tests for the tag read services.
import { describe, expect, it } from "vitest";
import type { TagsService } from "@/lib/validators/tags";
import { tagFilterSchema } from "@/lib/validators/tags";
import type { MockServiceContext } from "../ctx";
import type { MockStore } from "../store";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import * as tagsService from "./tags";
import { assignTags, createTag, getTag, listTags, tagUsage, unassignTag, updateTag } from "./tags";

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

describe("tags service type contract", () => {
  it("satisfies TagsService over the mock context", () => {
    const service = tagsService satisfies TagsService<MockServiceContext>;
    expect(typeof service.createTag).toBe("function");
  });
});

describe("createTag", () => {
  it("creates a tag with a generated id and no usage", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.tags.length;
    const created = await createTag(ctx, { name: "  Nuevo  ", color: "#123456" });
    expect(created).toMatchObject({ name: "Nuevo", color: "#123456", usageCount: 0 });
    expect(db.tags).toHaveLength(before + 1);
    expect(created.createdAt).toBe(FIXED_NOW.toISOString());
  });

  it("rejects a duplicate name case-insensitively with CONFLICT and the existing entity", async () => {
    const { ctx, db } = makeTestContext();
    const existing = db.tags.find((t) => t.id === "tag_cliente_clave")!;
    await expect(createTag(ctx, { name: "CLIENTE CLAVE", color: "#000000" })).rejects.toMatchObject(
      {
        code: "CONFLICT",
        entity: { type: "TAG", id: existing.id, label: existing.name },
      },
    );
  });
});

describe("updateTag", () => {
  it("renames and recolours, keeping its own name unique", async () => {
    const { ctx, db } = makeTestContext();
    const tag = db.tags[0]!;
    const updated = await updateTag(ctx, {
      id: tag.id,
      name: tag.name.toUpperCase(),
      color: "#abcdef",
    });
    expect(updated).toMatchObject({ id: tag.id, color: "#abcdef" });
    expect(updated.name).toBe(tag.name.toUpperCase());
  });

  it("refuses a name another tag holds", async () => {
    const { ctx, db } = makeTestContext();
    await expect(
      updateTag(ctx, { id: db.tags[0]!.id, name: db.tags[1]!.name }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("answers NOT_FOUND for an unknown tag", async () => {
    const { ctx } = makeTestContext();
    await expect(updateTag(ctx, { id: "tag_missing", color: "#000000" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("assignTags and unassignTag", () => {
  it("writes the tag ids on the record and ignores tags already assigned", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const client = db.clients.find((c) => !c.archivedAt)!;
    const [a, b] = db.tags;
    client.tagIds = [a!.id];
    const chips = await assignTags(ctx, {
      entityType: "CLIENT",
      entityId: client.id,
      tagIds: [a!.id, b!.id],
    });
    expect(client.tagIds).toEqual([a!.id, b!.id]);
    expect(chips.map((c) => c.id)).toEqual([a!.id, b!.id]);
  });

  it("removes one tag and returns the remaining chips", async () => {
    const { ctx, db } = makeTestContext("ADMIN");
    const project = db.projects.find((p) => !p.archivedAt)!;
    const [a, b] = db.tags;
    project.tagIds = [a!.id, b!.id];
    const chips = await unassignTag(ctx, {
      entityType: "PROJECT",
      entityId: project.id,
      tagId: a!.id,
    });
    expect(project.tagIds).toEqual([b!.id]);
    expect(chips.map((c) => c.id)).toEqual([b!.id]);
  });

  it("lets a Member tag projects and notes but not clients", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    const project = db.projects.find((p) => !p.archivedAt)!;
    const client = db.clients.find((c) => !c.archivedAt)!;
    const tagIds = [db.tags[0]!.id];
    const before = [...(client.tagIds ?? [])];
    await expect(
      assignTags(ctx, { entityType: "PROJECT", entityId: project.id, tagIds }),
    ).resolves.toBeDefined();
    await expect(
      assignTags(ctx, { entityType: "CLIENT", entityId: client.id, tagIds }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(client.tagIds).toEqual(before);
  });

  it("answers NOT_FOUND for an unknown or archived entity", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const tagIds = [db.tags[0]!.id];
    await expect(
      assignTags(ctx, { entityType: "NOTE", entityId: "note_missing", tagIds }),
    ).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const archived = db.clients.find((c) => c.archivedAt);
    if (archived) {
      await expect(
        assignTags(ctx, { entityType: "CLIENT", entityId: archived.id, tagIds }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
  });

  it("answers NOT_FOUND for finance types until H1-B3", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    await expect(
      assignTags(ctx, { entityType: "INVOICE", entityId: "inv_1", tagIds: [db.tags[0]!.id] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("tag activity (LINK / UNLINK on the tagged entity, PRD §8.14)", () => {
  const activitySince = (db: MockStore, from: number) => db.activity.slice(from);

  it("logs one LINK per tag actually added, on the tagged entity, with the tag in its metadata", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const project = db.projects.find((p) => !p.archivedAt)!;
    const [a, b, c] = db.tags;
    project.tagIds = [a!.id];
    const from = db.activity.length;
    await assignTags(ctx, {
      entityType: "PROJECT",
      entityId: project.id,
      tagIds: [a!.id, b!.id, b!.id, c!.id],
    });
    const entries = activitySince(db, from);
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      actorType: "USER",
      actorId: ctx.user.id,
      action: "LINK",
      entityType: "PROJECT",
      entityId: project.id,
      entityLabel: project.name,
      metadata: { tagId: b!.id, tagName: b!.name },
      createdAt: FIXED_NOW.toISOString(),
    });
    expect(entries[1]).toMatchObject({
      action: "LINK",
      metadata: { tagId: c!.id, tagName: c!.name },
    });
  });

  it("writes no entry when every tag was already assigned", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const project = db.projects.find((p) => !p.archivedAt)!;
    project.tagIds = [db.tags[0]!.id];
    const from = db.activity.length;
    await assignTags(ctx, {
      entityType: "PROJECT",
      entityId: project.id,
      tagIds: [db.tags[0]!.id],
    });
    expect(activitySince(db, from)).toHaveLength(0);
  });

  it("logs one UNLINK when a tag is removed, and none when it was not assigned", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const client = db.clients.find((c) => !c.archivedAt)!;
    const [a, b] = db.tags;
    client.tagIds = [a!.id];
    const from = db.activity.length;
    await unassignTag(ctx, { entityType: "CLIENT", entityId: client.id, tagId: b!.id });
    expect(activitySince(db, from)).toHaveLength(0);
    await unassignTag(ctx, { entityType: "CLIENT", entityId: client.id, tagId: a!.id });
    expect(activitySince(db, from)).toEqual([
      expect.objectContaining({
        action: "UNLINK",
        entityType: "CLIENT",
        entityId: client.id,
        entityLabel: client.tradeName,
        metadata: { tagId: a!.id, tagName: a!.name },
      }),
    ]);
  });

  it("writes no entry for a refused tagging (FORBIDDEN) or an unknown entity", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    const client = db.clients.find((c) => !c.archivedAt)!;
    const from = db.activity.length;
    await expect(
      assignTags(ctx, { entityType: "CLIENT", entityId: client.id, tagIds: [db.tags[0]!.id] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assignTags(ctx, { entityType: "NOTE", entityId: "note_missing", tagIds: [db.tags[0]!.id] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(activitySince(db, from)).toHaveLength(0);
  });

  it("writes no entry for createTag or updateTag: tag catalogue edits are not logged as SETTINGS_CHANGE", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const from = db.activity.length;
    const created = await createTag(ctx, { name: "Sin registro", color: "#123456" });
    await updateTag(ctx, { id: created.id, color: "#abcdef" });
    expect(activitySince(db, from)).toHaveLength(0);
  });
});
