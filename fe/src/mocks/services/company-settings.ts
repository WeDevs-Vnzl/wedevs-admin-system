// MOCK — company settings of Hito 1 (PRD §8.15 "Empresa", A1). `fn(ctx, input)`, framework-free (C11).
// Reads are open to any signed-in user, like the fiscal settings (the portal and the print views show the
// company); writes are Owner/Admin (`settings`) and log one `SETTINGS_CHANGE`. Replaced by
// `src/server/services/settings.service.ts` in Hito 2 (C9).
import { diffFields } from "@/lib/activity-diff";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import {
  SETTING_KEYS,
  type CompanySettings,
  type UpdateCompanySettingsInput,
} from "@/lib/validators/settings";
import { can } from "@/server/auth/permissions";
import { ServiceError, type MockServiceContext } from "../ctx";
import { logActivity, mockTx } from "./activity";

const COMPANY_FIELDS = ["name", "legalName", "taxId", "address", "logoFileId"] as const;

export async function getCompanySettings(ctx: MockServiceContext): Promise<CompanySettings> {
  return structuredClone(ctx.db.company);
}

/** Replaces the company profile. The logo must be a stored file (`VALIDATION` otherwise). */
export async function updateCompanySettings(
  ctx: MockServiceContext,
  input: UpdateCompanySettingsInput,
): Promise<CompanySettings> {
  if (!can(ctx.user, "update", "settings")) throw new ServiceError("FORBIDDEN");
  const { db } = ctx;
  if (input.logoFileId !== undefined && !db.files.some((file) => file.id === input.logoFileId)) {
    throw new ServiceError("VALIDATION", {
      fieldErrors: { logoFileId: [VALIDATION_MESSAGES.invalidId] },
    });
  }
  const next: CompanySettings = {
    name: input.name,
    legalName: input.legalName,
    taxId: input.taxId,
    address: input.address,
    logoFileId: input.logoFileId,
  };
  const changes = diffFields(db.company, next, { fields: COMPANY_FIELDS });
  db.company = next;
  if (changes) {
    await logActivity(mockTx(ctx), {
      actorType: "USER",
      actorId: ctx.user.id,
      action: "SETTINGS_CHANGE",
      entityType: "SETTING",
      entityId: SETTING_KEYS.company,
      entityLabel: next.name,
      changes,
    });
  }
  return structuredClone(next);
}
