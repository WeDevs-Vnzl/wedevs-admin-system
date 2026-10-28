import { describe, expect, it } from "vitest";
import {
  ALERT_MAX_SNOOZE_DAYS,
  ALERT_TYPE_VALUES,
  alertDismissalSchema,
  alertKeySchema,
  alertSchema,
  alertsSummarySchema,
  buildAlertKey,
  dismissAlertInputSchema,
  alertsInboxSchema,
  alertsReadResultSchema,
  listAlertsInputSchema,
  markAlertsReadInputSchema,
  parseAlertKey,
  restoreAlertInputSchema,
  snoozeAlertInputSchema,
  type AlertsService,
} from "./alerts";

describe("alert types (PRD §7.9)", () => {
  it("are exactly the nine of the table", () => {
    expect([...ALERT_TYPE_VALUES]).toEqual([
      "INVOICE_OVERDUE",
      "INVOICE_DUE_SOON",
      "INSTALLMENT_TO_INVOICE",
      "DOCUMENT_EXPIRING",
      "DOCUMENT_EXPIRED",
      "RECURRING_EXPENSE_PENDING",
      "PAYMENT_PENDING_VERIFICATION",
      "UNALLOCATED_CREDIT",
      "MISSING_RATE",
    ]);
  });
});

describe("alertKey", () => {
  it("builds and parses <TYPE>:<subject>", () => {
    expect(buildAlertKey("INVOICE_OVERDUE", "inv_0042")).toBe("INVOICE_OVERDUE:inv_0042");
    expect(parseAlertKey("INVOICE_OVERDUE:inv_0042")).toEqual({
      type: "INVOICE_OVERDUE",
      subject: "inv_0042",
    });
    expect(parseAlertKey("MISSING_RATE:VES:2026-10-09")).toEqual({
      type: "MISSING_RATE",
      subject: "VES:2026-10-09",
    });
  });

  it("accepts valid keys and rejects malformed ones", () => {
    for (const key of [
      "INVOICE_OVERDUE:inv_1",
      "MISSING_RATE:VES:2026-10-09",
      "DOCUMENT_EXPIRED:doc_1",
    ]) {
      expect(alertKeySchema.safeParse(key).success, key).toBe(true);
    }
    for (const bad of [
      "",
      "INVOICE_OVERDUE",
      "INVOICE_OVERDUE:",
      "UNKNOWN_TYPE:x",
      "invoice_overdue:x",
      "INVOICE_OVERDUE:a b",
      `INVOICE_OVERDUE:${"x".repeat(200)}`,
    ]) {
      expect(alertKeySchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("inputs", () => {
  it("dismiss and restore take a key", () => {
    expect(dismissAlertInputSchema.safeParse({ alertKey: "INVOICE_OVERDUE:inv_1" }).success).toBe(
      true,
    );
    expect(dismissAlertInputSchema.safeParse({ alertKey: "nope" }).success).toBe(false);
    expect(restoreAlertInputSchema.safeParse({ alertKey: "INVOICE_OVERDUE:inv_1" }).success).toBe(
      true,
    );
  });

  it("snooze needs 1…90 whole days", () => {
    const base = { alertKey: "DOCUMENT_EXPIRING:doc_1" };
    expect(snoozeAlertInputSchema.safeParse({ ...base, days: 1 }).success).toBe(true);
    expect(snoozeAlertInputSchema.safeParse({ ...base, days: ALERT_MAX_SNOOZE_DAYS }).success).toBe(
      true,
    );
    for (const days of [0, -3, ALERT_MAX_SNOOZE_DAYS + 1, 1.5]) {
      expect(snoozeAlertInputSchema.safeParse({ ...base, days }).success, String(days)).toBe(false);
    }
    expect(snoozeAlertInputSchema.safeParse(base).success).toBe(false);
  });

  it("listAlerts filters by type and caps the limit", () => {
    expect(listAlertsInputSchema.parse({}).limit).toBe(50);
    expect(listAlertsInputSchema.parse({ types: "INVOICE_OVERDUE" }).types).toEqual([
      "INVOICE_OVERDUE",
    ]);
    expect(listAlertsInputSchema.safeParse({ types: "OTHER" }).success).toBe(false);
    expect(listAlertsInputSchema.safeParse({ limit: 201 }).success).toBe(false);
  });
});

describe("DTOs", () => {
  const alert = {
    alertKey: "INVOICE_OVERDUE:inv_1",
    type: "INVOICE_OVERDUE",
    entity: { id: "inv_1", code: "FAC-0001", label: "FAC-0001", type: "INVOICE" },
    date: "2026-09-30",
    days: -9,
    amount: { amount: "1800.50", currency: "USD" },
    context: "Kairos Studio",
  };

  it("alert amounts are money strings (C15)", () => {
    expect(alertSchema.safeParse(alert).success).toBe(true);
    expect(
      alertSchema.safeParse({ ...alert, amount: { amount: 1800.5, currency: "USD" } }).success,
    ).toBe(false);
    expect(
      alertSchema.safeParse({
        alertKey: "MISSING_RATE:VES:2026-10-09",
        type: "MISSING_RATE",
        entity: null,
        date: "2026-10-09",
        days: 0,
        amount: null,
        context: null,
      }).success,
    ).toBe(true);
  });

  it("summary and dismissal", () => {
    expect(
      alertsSummarySchema.safeParse({ total: 1, byType: { INVOICE_OVERDUE: 1 }, items: [alert] })
        .success,
    ).toBe(true);
    expect(
      alertsSummarySchema.safeParse({ total: 0, byType: { WRONG: 1 }, items: [] }).success,
    ).toBe(false);
    expect(
      alertDismissalSchema.safeParse({
        alertKey: "INVOICE_OVERDUE:inv_1",
        dismissedUntil: null,
        active: false,
      }).success,
    ).toBe(true);
  });
});

describe("mark as read (A2)", () => {
  it("takes one to 200 valid alert keys", () => {
    expect(
      markAlertsReadInputSchema.safeParse({ alertKeys: ["INVOICE_OVERDUE:inv_1"] }).success,
    ).toBe(true);
    expect(markAlertsReadInputSchema.safeParse({ alertKeys: [] }).success).toBe(false);
    expect(markAlertsReadInputSchema.safeParse({ alertKeys: ["NOPE:x"] }).success).toBe(false);
    const many = Array.from({ length: 201 }, (_, i) => `INVOICE_OVERDUE:inv_${i}`);
    expect(markAlertsReadInputSchema.safeParse({ alertKeys: many }).success).toBe(false);
  });

  it("the inbox extends the summary with the unread counter and the read keys", () => {
    const summary = { total: 1, byType: { INVOICE_OVERDUE: 1 }, items: [] };
    expect(
      alertsInboxSchema.safeParse({ ...summary, unread: 0, readKeys: ["INVOICE_OVERDUE:inv_1"] })
        .success,
    ).toBe(true);
    expect(alertsInboxSchema.safeParse({ ...summary, unread: -1, readKeys: [] }).success).toBe(
      false,
    );
    expect(alertsSummarySchema.safeParse(summary).success).toBe(true);
  });

  it("the result lists the keys marked read", () => {
    expect(
      alertsReadResultSchema.safeParse({ alertKeys: ["MISSING_RATE:VES:2026-10-09"] }).success,
    ).toBe(true);
  });

  it("AlertsService keeps its four services and adds markAlertsRead", () => {
    const names = [
      "listAlerts",
      "dismissAlert",
      "snoozeAlert",
      "restoreAlert",
      "markAlertsRead",
    ] as const satisfies readonly (keyof AlertsService)[];
    expect(new Set(names).size).toBe(5);
  });
});
