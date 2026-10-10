import { describe, expect, it } from "vitest";
import { activityChangesSchema } from "@/lib/validators/activity";
import { diffFields } from "./activity-diff";

describe("diffFields", () => {
  it("records [before, after] for the fields that changed, in the order of `fields`", () => {
    const changes = diffFields(
      { tradeName: "Kairos", phone: "+584125550001", status: "PROSPECTO" },
      { tradeName: "Kairos Studio", phone: "+584125550001", status: "ACTIVO" },
      { fields: ["status", "phone", "tradeName"] },
    );
    expect(changes).toEqual({
      status: ["PROSPECTO", "ACTIVO"],
      tradeName: ["Kairos", "Kairos Studio"],
    });
    expect(Object.keys(changes ?? {})).toEqual(["status", "tradeName"]);
    expect(activityChangesSchema.safeParse(changes).success).toBe(true);
  });

  it("returns undefined when nothing changed", () => {
    expect(
      diffFields(
        { a: "x", b: null, c: true },
        { a: "x", b: null, c: true },
        {
          fields: ["a", "b", "c"],
        },
      ),
    ).toBeUndefined();
    expect(diffFields({}, {}, { fields: [] })).toBeUndefined();
  });

  it("keeps money as the decimal string, never a number", () => {
    const changes = diffFields(
      { amount: "1250.00", rate: 755.16 },
      { amount: "1300.50", rate: 760 },
      { fields: ["amount", "rate"] },
    );
    expect(changes).toEqual({ amount: ["1250.00", "1300.50"], rate: ["755.16", "760"] });
    for (const change of Object.values(changes ?? {})) {
      for (const value of change as unknown[]) expect(typeof value).toBe("string");
    }
  });

  it("records only the marker for long texts", () => {
    const changes = diffFields(
      { summary: "Old", description: "A long description…" },
      { summary: "New", description: "Another long description…" },
      { fields: ["summary", "description"], longText: ["description"] },
    );
    expect(changes).toEqual({ summary: ["Old", "New"], description: "changed" });
  });

  it("does not mark an unchanged long text", () => {
    expect(
      diffFields(
        { description: "same" },
        { description: "same" },
        {
          fields: ["description"],
          longText: ["description"],
        },
      ),
    ).toBeUndefined();
  });

  it("never lists an excluded field, even when it changed and is in `fields`", () => {
    const changes = diffFields(
      { name: "A", accessKey: "old" },
      { name: "B", accessKey: "new" },
      { fields: ["name", "accessKey"], exclude: ["accessKey"] },
    );
    expect(changes).toEqual({ name: ["A", "B"] });
    expect(
      diffFields(
        { accessKey: "old" },
        { accessKey: "new" },
        {
          fields: ["accessKey"],
          exclude: ["accessKey"],
        },
      ),
    ).toBeUndefined();
  });

  it("treats a missing value as null and normalizes booleans, dates and structures", () => {
    const changes = diffFields(
      { email: "a@example.com", isPrimary: false, due: new Date("2026-10-01T00:00:00Z") },
      { isPrimary: true, due: new Date("2026-10-02T00:00:00Z"), tags: ["x"] },
      { fields: ["email", "isPrimary", "due", "tags"] },
    );
    expect(changes).toEqual({
      email: ["a@example.com", null],
      isPrimary: [false, true],
      due: ["2026-10-01T00:00:00.000Z", "2026-10-02T00:00:00.000Z"],
      tags: [null, '["x"]'],
    });
  });
});
