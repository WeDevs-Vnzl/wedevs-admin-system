// MOCK — tests for the company settings services (PRD §8.15 "Empresa", A1).
import { describe, expect, it } from "vitest";
import type { CompanySettingsService } from "@/lib/validators/settings";
import { updateCompanySettingsInputSchema } from "@/lib/validators/settings";
import type { MockServiceContext } from "../ctx";
import { makeTestContext } from "../test-helpers";
import * as companySettingsService from "./company-settings";
import { getCompanySettings, updateCompanySettings } from "./company-settings";

const input = (over: Record<string, unknown> = {}) =>
  updateCompanySettingsInputSchema.parse({
    name: "WeDevs Studio",
    legalName: "WeDevs Studio, C.A.",
    taxId: "J-12345678-9",
    address: "Calle Demo 1, Caracas",
    ...over,
  });

describe("getCompanySettings", () => {
  it("returns a copy of the stored company profile", async () => {
    const { ctx, db } = makeTestContext("MEMBER");
    const company = await getCompanySettings(ctx);
    expect(company).toEqual(db.company);
    company.name = "changed";
    expect(db.company.name).not.toBe("changed");
  });
});

describe("updateCompanySettings", () => {
  it("stores name, legal name, RIF, address and logo, and logs SETTINGS_CHANGE", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const logoFileId = db.files[0]!.id;
    const before = db.activity.length;
    const saved = await updateCompanySettings(ctx, input({ logoFileId }));
    expect(saved).toEqual({
      name: "WeDevs Studio",
      legalName: "WeDevs Studio, C.A.",
      taxId: "J-12345678-9",
      address: "Calle Demo 1, Caracas",
      logoFileId,
    });
    expect(db.company).toEqual(saved);
    expect(db.activity).toHaveLength(before + 1);
    expect(db.activity.at(-1)).toMatchObject({
      action: "SETTINGS_CHANGE",
      entityType: "SETTING",
      entityId: "company",
      actorId: ctx.user.id,
      changes: { name: ["WeDevs", "WeDevs Studio"] },
    });
  });

  it("logs nothing when nothing changed", async () => {
    const { ctx, db } = makeTestContext("ADMIN");
    const before = db.activity.length;
    await updateCompanySettings(ctx, updateCompanySettingsInputSchema.parse(db.company));
    expect(db.activity).toHaveLength(before);
  });

  it("refuses a logo that is not a stored file (VALIDATION) and keeps the profile", async () => {
    const { ctx, db } = makeTestContext("OWNER");
    const previous = structuredClone(db.company);
    await expect(
      updateCompanySettings(ctx, input({ logoFileId: "fil_missing" })),
    ).rejects.toMatchObject({ code: "VALIDATION", fieldErrors: { logoFileId: expect.any(Array) } });
    expect(db.company).toEqual(previous);
  });

  it("is Owner/Admin only (FORBIDDEN for Member and Viewer)", async () => {
    for (const role of ["MEMBER", "VIEWER"] as const) {
      const { ctx, db } = makeTestContext(role);
      const previous = structuredClone(db.company);
      await expect(updateCompanySettings(ctx, input())).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      expect(db.company).toEqual(previous);
    }
  });

  it("satisfies CompanySettingsService over the mock context", () => {
    const service = companySettingsService satisfies CompanySettingsService<MockServiceContext>;
    expect(typeof service.updateCompanySettings).toBe("function");
  });
});
