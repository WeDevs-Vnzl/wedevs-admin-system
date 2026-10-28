import { describe, expect, it } from "vitest";
import {
  ACTIVITY_ACTION_VALUES,
  ENTITY_TYPE_VALUES,
  ENUM_REGISTRY,
  SHARE_EVENT_VALUES,
  USER_ROLE_VALUES,
  activityActionSchema,
  invoiceStatusSchema,
  shareEventSchema,
  userRoleSchema,
} from "./enums";

describe("enums (PRD §10.2 + data-rules §3a Δ2)", () => {
  it("mirrors all 24 Prisma enums", () => {
    expect(Object.keys(ENUM_REGISTRY)).toHaveLength(24);
  });

  it("keeps PRD values verbatim (UPPER_SNAKE, Spanish domain values)", () => {
    expect([...USER_ROLE_VALUES]).toEqual(["OWNER", "ADMIN", "MEMBER", "VIEWER"]);
    expect(ENUM_REGISTRY.InvoiceStatus).toEqual([
      "BORRADOR",
      "EMITIDA",
      "PARCIAL",
      "PAGADA",
      "VENCIDA",
      "ANULADA",
    ]);
    expect(ENUM_REGISTRY.PaymentStatus).toEqual([
      "PENDIENTE_VERIFICACION",
      "CONFIRMADO",
      "ANULADO",
    ]);
    expect(ENUM_REGISTRY.ProjectStatus).toContain("EN_CURSO");
    expect(ENUM_REGISTRY.RateSource).toEqual(["MANUAL", "BCV", "OTRA"]);
    expect(ENTITY_TYPE_VALUES).toHaveLength(20);
    expect(ACTIVITY_ACTION_VALUES).toHaveLength(18);
  });

  it("adds UNLOCK and UNLOCK_FAILED to ShareEvent (Δ2) after the PRD values", () => {
    expect([...SHARE_EVENT_VALUES]).toEqual(["VIEW", "DOWNLOAD", "UNLOCK", "UNLOCK_FAILED"]);
    expect(shareEventSchema.safeParse("UNLOCK_FAILED").success).toBe(true);
  });

  it("has no duplicate values inside any enum", () => {
    for (const values of Object.values(ENUM_REGISTRY)) {
      expect(new Set(values).size).toBe(values.length);
    }
  });

  it("schemas accept their values and reject anything else", () => {
    expect(userRoleSchema.parse("OWNER")).toBe("OWNER");
    expect(userRoleSchema.safeParse("owner").success).toBe(false);
    expect(invoiceStatusSchema.safeParse("PAID").success).toBe(false);
    expect(activityActionSchema.safeParse("PORTAL_ACCESS").success).toBe(true);
  });
});
