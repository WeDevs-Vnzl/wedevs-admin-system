// MOCK — tests for the trash services (PRD §7.7, HU-28 CA2, carried F8: archived projects restore).
import { describe, expect, it } from "vitest";
import { addDays, toDateOnly } from "@/lib/dates";
import { trashFilterSchema, trashRowSchema, type TrashService } from "@/lib/validators/trash";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import * as trashService from "./trash";
import { listTrash, restoreFromTrash } from "./trash";

const filter = (over: Record<string, unknown> = {}) => trashFilterSchema.parse(over);
const ids = (page: { items: { entity: { id: string } }[] }) => page.items.map((r) => r.entity.id);

describe("listTrash", () => {
  it("lists every archived record, newest first, with who archived it", async () => {
    const { ctx } = makeTestContext("OWNER");
    const page = await listTrash(ctx, filter());
    expect(ids(page).sort()).toEqual(
      [
        "cli_veredas_digital",
        "con_veredas_digital_1",
        "con_solaris_energia_2",
        "pry_veredas_landing",
        "note_borrada_prueba",
      ].sort(),
    );
    expect(page.items.every((row) => trashRowSchema.safeParse(row).success)).toBe(true);
    const times = page.items.map((row) => row.deletedAt);
    expect(times).toEqual([...times].sort().reverse());
    expect(page.items.find((row) => row.entity.id === "pry_veredas_landing")).toMatchObject({
      entity: { type: "PROJECT", code: expect.any(String) },
      deletedBy: { id: "usr_camila_torres", name: "Camila Torres" },
    });
  });

  it("filters by type, by who archived, by date and by text", async () => {
    const { ctx, db } = makeTestContext("ADMIN");
    expect(ids(await listTrash(ctx, filter({ entityType: ["PROJECT"] })))).toEqual([
      "pry_veredas_landing",
    ]);
    const byCamila = await listTrash(ctx, filter({ deletedById: ["usr_camila_torres"] }));
    expect(byCamila.items.every((row) => row.deletedBy?.id === "usr_camila_torres")).toBe(true);
    const project = db.projects.find((row) => row.id === "pry_veredas_landing")!;
    const day = toDateOnly(new Date(project.archivedAt!));
    const sameDay = await listTrash(ctx, filter({ deletedFrom: day, deletedTo: day }));
    expect(ids(sameDay)).toContain("pry_veredas_landing");
    const later = await listTrash(ctx, filter({ deletedFrom: addDays(day, 1) }));
    expect(ids(later)).not.toContain("pry_veredas_landing");
    expect(ids(await listTrash(ctx, filter({ q: "veredas", entityType: ["CLIENT"] })))).toEqual([
      "cli_veredas_digital",
    ]);
  });

  it("is Owner/Admin only", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { ctx } = makeTestContext(role);
      await expect(listTrash(ctx, filter())).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });
});

describe("HU-28 CA2: restoring returns the record to its previous state and logs RESTORE", () => {
  it("restores an archived project with its status untouched (F8)", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const project = db.projects.find((row) => row.id === "pry_veredas_landing")!;
    const status = project.status;
    const result = await restoreFromTrash(ctx, { entityType: "PROJECT", entityId: project.id });
    expect(result).toEqual({
      entity: { type: "PROJECT", id: project.id, code: project.code, label: project.name },
      restoredAt: ctx.now.toISOString(),
    });
    expect(project).toMatchObject({ archivedAt: null, deletedById: null, status });
    expect(db.activity.at(-1)).toMatchObject({
      action: "RESTORE",
      entityType: "PROJECT",
      entityId: project.id,
      actorId: ctx.user.id,
      createdAt: ctx.now.toISOString(),
    });
    expect(ids(await listTrash(ctx, filter()))).not.toContain(project.id);
  });

  it("restores a note and a contact of a live client", async () => {
    const { ctx, db } = makeTestContext("ADMIN");
    await restoreFromTrash(ctx, { entityType: "NOTE", entityId: "note_borrada_prueba" });
    await restoreFromTrash(ctx, { entityType: "CONTACT", entityId: "con_solaris_energia_2" });
    expect(db.notes.find((row) => row.id === "note_borrada_prueba")?.archivedAt).toBeNull();
    expect(db.contacts.find((row) => row.id === "con_solaris_energia_2")?.archivedAt).toBeNull();
    expect(db.activity.slice(-2).map((row) => [row.action, row.entityType])).toEqual([
      ["RESTORE", "NOTE"],
      ["RESTORE", "CONTACT"],
    ]);
  });

  it("a client brings back the contacts archived with it, each logged", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    await restoreFromTrash(ctx, { entityType: "CLIENT", entityId: "cli_veredas_digital" });
    expect(db.clients.find((row) => row.id === "cli_veredas_digital")?.archivedAt).toBeNull();
    expect(db.contacts.find((row) => row.id === "con_veredas_digital_1")?.archivedAt).toBeNull();
    expect(db.activity.slice(-2).map((row) => [row.action, row.entityId])).toEqual([
      ["RESTORE", "cli_veredas_digital"],
      ["RESTORE", "con_veredas_digital_1"],
    ]);
  });

  it("a contact whose client is still archived cannot come back alone (CONFLICT)", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const before = db.activity.length;
    await expect(
      restoreFromTrash(ctx, { entityType: "CONTACT", entityId: "con_veredas_digital_1" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(
      db.contacts.find((row) => row.id === "con_veredas_digital_1")?.archivedAt,
    ).not.toBeNull();
    expect(db.activity).toHaveLength(before);
  });

  it("a project or a note comes back even while its client stays archived (no CONFLICT, user 2026-10-20)", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const note = db.notes.find((row) => row.id === "note_borrada_prueba")!;
    note.links = [{ entityType: "CLIENT", entityId: "cli_veredas_digital" }];
    await restoreFromTrash(ctx, { entityType: "PROJECT", entityId: "pry_veredas_landing" });
    await restoreFromTrash(ctx, { entityType: "NOTE", entityId: note.id });
    expect(db.clients.find((row) => row.id === "cli_veredas_digital")?.archivedAt).not.toBeNull();
    expect(db.projects.find((row) => row.id === "pry_veredas_landing")?.archivedAt).toBeNull();
    expect(note.archivedAt).toBeNull();
  });

  it("a live record, an unknown id or a non-archivable type is NOT_FOUND", async () => {
    const { ctx } = makeTestContext("OWNER");
    await expect(
      restoreFromTrash(ctx, { entityType: "CLIENT", entityId: "cli_zafiro_labs" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      restoreFromTrash(ctx, { entityType: "PAYMENT", entityId: "pag_1" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("Members cannot restore (FORBIDDEN) and nothing changes", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    await expect(
      restoreFromTrash(ctx, { entityType: "PROJECT", entityId: "pry_veredas_landing" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.projects.find((row) => row.id === "pry_veredas_landing")?.archivedAt).not.toBeNull();
  });

  it("satisfies TrashService over the mock context", () => {
    const service = trashService satisfies TrashService<MockServiceContext>;
    expect(typeof service.listTrash).toBe("function");
  });
});
