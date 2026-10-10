// MOCK — tests for the activity seam: `mockTx` and `logActivity` (append-only, C20).
import { describe, expect, it } from "vitest";
import { activityEntrySchema } from "@/lib/validators/activity";
import { FIXED_NOW, makeTestContext } from "../test-helpers";
import * as activityService from "./activity";
import { logActivity, mockTx, toActivityEntryDTO } from "./activity";

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
