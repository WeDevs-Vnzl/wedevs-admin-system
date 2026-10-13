// MOCK — tests for the activity seam: `mockTx` and `logActivity` (append-only, C20).
import { describe, expect, it } from "vitest";
import { activityEntrySchema } from "@/lib/validators/activity";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import * as activityService from "./activity";
import { listActivity, logActivity, mockTx, toActivityEntryDTO, type MockTx } from "./activity";
import type { MockServiceContext } from "../ctx";
import { activityFilterSchema, type ActivityService } from "@/lib/validators/activity";

// Type test: the module satisfies the PRD §12 activity contract (C8, C9).
const contract = { logActivity, listActivity } satisfies Pick<
  ActivityService<MockServiceContext, MockTx>,
  "logActivity" | "listActivity"
>;

describe("mockTx", () => {
  it("is the store and the clock of the context", () => {
    const { ctx, db } = makeTestContext();
    expect(mockTx(ctx)).toEqual({ db, now: FIXED_NOW });
    expect(mockTx(ctx).db).toBe(db);
  });
});

describe("logActivity", () => {
  it("validates, appends a row and returns the entry (id from nextMockId, createdAt = tx.now)", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.activity.length;
    const entry = await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: "usr_andres_molina",
      action: "UPDATE",
      entityType: "CLIENT",
      entityId: "cli_kairos",
      entityLabel: "Kairos Studio",
      changes: { phone: ["+584125550001", "+584125550002"] },
      metadata: { source: "form" },
      ip: "192.0.2.14",
      userAgent: "Mozilla/5.0",
    });

    expect(() => activityEntrySchema.parse(entry)).not.toThrow();
    expect(entry.createdAt).toBe(FIXED_NOW.toISOString());
    expect(entry.id).toMatch(/^act_\d{4,}$/);
    expect(entry.actor).toEqual({
      type: "USER",
      id: "usr_andres_molina",
      name: "Andrés Molina",
      imageUrl: null,
    });
    expect(db.activity).toHaveLength(before + 1);
    expect(db.activity.at(-1)).toMatchObject({
      id: entry.id,
      actorType: "USER",
      actorId: "usr_andres_molina",
      changes: { phone: ["+584125550001", "+584125550002"] },
    });
    expect(db.activity.at(-1)).not.toHaveProperty("actor");
  });

  it("never reuses an id of the fixtures and keeps ids unique across calls", async () => {
    const { ctx, db } = makeTestContext();
    const a = await logActivity(mockTx(ctx), {
      actorType: "SYSTEM",
      action: "SYSTEM_JOB",
      entityType: "DOCUMENT",
      entityId: "doc_nda_tamanaco",
      entityLabel: "NDA",
    });
    const b = await logActivity(mockTx(ctx), {
      actorType: "SYSTEM",
      action: "SYSTEM_JOB",
      entityType: "DOCUMENT",
      entityId: "doc_nda_tamanaco",
      entityLabel: "NDA",
    });
    expect(a.id).not.toBe(b.id);
    expect(new Set(db.activity.map((row) => row.id)).size).toBe(db.activity.length);
    expect(a.actor).toEqual({ type: "SYSTEM", id: null, name: null, imageUrl: null });
    expect(a).toMatchObject({ changes: null, metadata: null, ip: null, userAgent: null });
  });

  it("rejects invalid inputs with VALIDATION and appends nothing", async () => {
    const { ctx, db } = makeTestContext();
    const before = db.activity.length;
    await expect(
      logActivity(mockTx(ctx), {
        actorType: "USER",
        action: "CREATE",
        entityType: "CLIENT",
        entityId: "cli_kairos",
        entityLabel: "Kairos Studio",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      logActivity(mockTx(ctx), {
        actorType: "PUBLIC",
        actorId: "usr_andres_molina",
        action: "PORTAL_ACCESS",
        entityType: "DOCUMENT",
        entityId: "doc_nda_tamanaco",
        entityLabel: "NDA",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      logActivity(mockTx(ctx), {
        actorType: "SYSTEM",
        action: "SYSTEM_JOB",
        entityType: "DOCUMENT",
        entityId: "doc_nda_tamanaco",
        entityLabel: "",
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(db.activity).toHaveLength(before);
  });

  it("is append-only: the module exposes no update or delete (C20)", () => {
    const names = Object.keys(activityService);
    expect(names.filter((name) => /update|delete|remove|edit|purge/i.test(name))).toEqual([]);
  });
});

describe("toActivityEntryDTO", () => {
  it("resolves the actor of a USER row and leaves SYSTEM and PUBLIC without a name", () => {
    const { db } = makeTestContext();
    const user = db.activity.find((row) => row.actorType === "USER")!;
    expect(toActivityEntryDTO(db, user).actor.name).not.toBeNull();
    const system = db.activity.find((row) => row.actorType === "SYSTEM")!;
    expect(toActivityEntryDTO(db, system).actor).toMatchObject({ id: null, name: null });
  });
});

describe("listActivity", () => {
  const filter = (input: Record<string, unknown> = {}) => activityFilterSchema.parse(input);

  it("is the contract's listActivity and returns entries newest first", async () => {
    const { ctx } = makeTestContext();
    expect(contract.listActivity).toBe(listActivity);
    const result = await listActivity(ctx, filter({ pageSize: 100 }));
    expect(result.total).toBeGreaterThan(100);
    const times = result.items.map((item) => item.createdAt);
    expect([...times].sort().reverse()).toEqual(times);
    result.items.forEach((item) => activityEntrySchema.parse(item));
  });

  it("filters by actor type, action and entity type (lists are ORed inside a facet)", async () => {
    const { ctx } = makeTestContext();
    const system = await listActivity(ctx, filter({ actorType: "SYSTEM", pageSize: 100 }));
    expect(system.items.length).toBeGreaterThan(0);
    expect(system.items.every((item) => item.actor.type === "SYSTEM")).toBe(true);

    const updates = await listActivity(
      ctx,
      filter({ action: ["UPDATE", "STATUS_CHANGE"], pageSize: 100 }),
    );
    expect(updates.items.every((item) => ["UPDATE", "STATUS_CHANGE"].includes(item.action))).toBe(
      true,
    );

    const clients = await listActivity(ctx, filter({ entityType: "CLIENT", pageSize: 100 }));
    expect(clients.items.every((item) => item.entityType === "CLIENT")).toBe(true);
  });

  it("filters one record's timeline by entity type and id", async () => {
    const { ctx, db } = makeTestContext();
    const target = db.activity.find((row) => row.entityType === "CLIENT")!;
    const timeline = await listActivity(
      ctx,
      filter({ entityType: "CLIENT", entityId: target.entityId }),
    );
    expect(timeline.items.length).toBeGreaterThan(0);
    expect(timeline.items.every((item) => item.entityId === target.entityId)).toBe(true);
  });

  it("filters by actor id (user filter)", async () => {
    const { ctx, db } = makeTestContext();
    const actorId = db.activity.find((row) => row.actorType === "USER")!.actorId!;
    const result = await listActivity(ctx, filter({ actorId, pageSize: 100 }));
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.items.every((item) => item.actor.id === actorId)).toBe(true);
  });

  it("bounds the date range by the Caracas calendar day, inclusive", async () => {
    const { ctx, db } = makeTestContext();
    // 02:30 UTC on 2026-10-08 is still 2026-10-07 in Caracas (UTC-4): the day boundary is Caracas, not UTC.
    db.activity.push({
      ...db.activity[0]!,
      id: "act_boundary_probe",
      actorType: "SYSTEM",
      actorId: null,
      createdAt: "2026-10-08T02:30:00.000Z",
    });
    const day = await listActivity(
      ctx,
      filter({ from: "2026-10-07", to: "2026-10-07", pageSize: 100 }),
    );
    expect(day.items.map((item) => item.id)).toContain("act_boundary_probe");
    const nextDay = await listActivity(
      ctx,
      filter({ from: "2026-10-08", to: "2026-10-08", pageSize: 100 }),
    );
    expect(nextDay.items.map((item) => item.id)).not.toContain("act_boundary_probe");
  });

  it("pages the result with total and pageCount", async () => {
    const { ctx } = makeTestContext();
    const first = await listActivity(ctx, filter({ pageSize: 25, page: 1 }));
    const second = await listActivity(ctx, filter({ pageSize: 25, page: 2 }));
    expect(first.items).toHaveLength(25);
    expect(second.page).toBe(2);
    expect(first.items[0]!.id).not.toBe(second.items[0]!.id);
    expect(first.pageCount).toBe(Math.ceil(first.total / 25));
  });

  it("returns an empty page for an unmatched filter", async () => {
    const { ctx } = makeTestContext();
    const none = await listActivity(
      ctx,
      filter({ entityType: "TAG", entityId: "tag_missing_probe" }),
    );
    expect(none).toMatchObject({ items: [], total: 0 });
  });
});
