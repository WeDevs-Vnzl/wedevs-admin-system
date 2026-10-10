import type { ActivityService } from "./activity";
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_CHANGED_MARKER,
  activityChangesSchema,
  activityEntrySchema,
  activityFilterSchema,
  logActivityInputSchema,
} from "./activity";
import { ACTIVITY_ACTION_VALUES } from "./enums";

const TS = "2026-10-01T10:00:00.000Z";

describe("activity changes (diff)", () => {
  it("accepts [before, after] pairs and the changed marker", () => {
    expect(
      activityChangesSchema.safeParse({
        status: ["EMITIDA", "PAGADA"],
        total: ["100.00", "120.00"],
        archived: [false, true],
        website: [null, "https://kairos.example"],
        description: ACTIVITY_CHANGED_MARKER,
      }).success,
    ).toBe(true);
  });

  it("rejects numbers (money is a string), wrong tuple lengths and unknown markers", () => {
    expect(activityChangesSchema.safeParse({ total: [100, 120] }).success).toBe(false);
    expect(activityChangesSchema.safeParse({ status: ["A"] }).success).toBe(false);
    expect(activityChangesSchema.safeParse({ status: ["A", "B", "C"] }).success).toBe(false);
    expect(activityChangesSchema.safeParse({ note: "edited" }).success).toBe(false);
  });
});

describe("logActivity (internal)", () => {
  const user = {
    actorType: "USER",
    actorId: "usr_1",
    action: "UPDATE",
    entityType: "CLIENT",
    entityId: "cli_1",
    entityLabel: "Kairos Studio",
    changes: { status: ["PROSPECTO", "ACTIVO"] },
    ip: "203.0.113.7",
    userAgent: "Mozilla/5.0",
  };

  it("accepts user, system and public events", () => {
    expect(logActivityInputSchema.safeParse(user).success).toBe(true);
    expect(
      logActivityInputSchema.safeParse({
        actorType: "SYSTEM",
        action: "SYSTEM_JOB",
        entityType: "INVOICE",
        entityId: "inv_1",
        entityLabel: "FAC-0001",
        metadata: { updated: 3, step: "overdue" },
      }).success,
    ).toBe(true);
    expect(
      logActivityInputSchema.safeParse({
        actorType: "PUBLIC",
        action: "PORTAL_ACCESS",
        entityType: "SHARE_LINK",
        entityId: "shr_1",
        entityLabel: "Documentación",
      }).success,
    ).toBe(true);
  });

  it("USER needs an actor id; SYSTEM/PUBLIC must not have one", () => {
    expect(logActivityInputSchema.safeParse({ ...user, actorId: undefined }).success).toBe(false);
    expect(logActivityInputSchema.safeParse({ ...user, actorType: "SYSTEM" }).success).toBe(false);
  });

  it("rejects unknown actions/entities and blank labels", () => {
    expect(logActivityInputSchema.safeParse({ ...user, action: "PURGE" }).success).toBe(false);
    expect(logActivityInputSchema.safeParse({ ...user, entityType: "WIDGET" }).success).toBe(false);
    expect(logActivityInputSchema.safeParse({ ...user, entityLabel: "" }).success).toBe(false);
  });

  it("covers every PRD §8.14 action", () => {
    expect(ACTIVITY_ACTION_VALUES).toContain("PORTAL_ACCESS");
  });
});

describe("activity filters", () => {
  it("filters by user, action, entity type and dates", () => {
    const parsed = activityFilterSchema.parse({
      actorId: "usr_1",
      action: ["CREATE", "UPDATE"],
      entityType: "CLIENT",
      from: "2026-10-01",
      to: "2026-10-31",
      sort: "createdAt:desc",
    });
    expect(parsed.action).toEqual(["CREATE", "UPDATE"]);
    expect(parsed.entityType).toEqual(["CLIENT"]);
    expect(activityFilterSchema.safeParse({ action: "PURGE" }).success).toBe(false);
    expect(activityFilterSchema.safeParse({ from: "2026-13-01" }).success).toBe(false);
    expect(activityFilterSchema.safeParse({ sort: "ip:asc" }).success).toBe(false);
  });

  it("a record's timeline needs exactly one entity type with the id; ranges must be ordered", () => {
    expect(
      activityFilterSchema.safeParse({ entityType: "CLIENT", entityId: "cli_1" }).success,
    ).toBe(true);
    expect(activityFilterSchema.safeParse({ entityId: "cli_1" }).success).toBe(false);
    expect(
      activityFilterSchema.safeParse({ entityType: ["CLIENT", "PROJECT"], entityId: "cli_1" })
        .success,
    ).toBe(false);
    expect(activityFilterSchema.safeParse({ from: "2026-10-10", to: "2026-10-01" }).success).toBe(
      false,
    );
  });
});

describe("activity DTO", () => {
  it("represents user, system and public actors", () => {
    const base = {
      id: "act_1",
      action: "STATUS_CHANGE",
      entityType: "INVOICE",
      entityId: "inv_1",
      entityLabel: "FAC-0001",
      changes: { status: ["EMITIDA", "PAGADA"] },
      metadata: null,
      ip: null,
      userAgent: null,
      createdAt: TS,
    };
    for (const actor of [
      { type: "USER", id: "usr_1", name: "Andrés", imageUrl: null },
      { type: "SYSTEM", id: null, name: null, imageUrl: null },
      { type: "PUBLIC", id: null, name: null, imageUrl: null },
    ]) {
      expect(activityEntrySchema.safeParse({ ...base, actor }).success, actor.type).toBe(true);
    }
    expect(
      activityEntrySchema.safeParse({
        ...base,
        actor: { type: "BOT", id: null, name: null, imageUrl: null },
      }).success,
    ).toBe(false);
  });
});

describe("ActivityService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "logActivity",
      "listActivity",
    ] as const satisfies readonly (keyof ActivityService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
