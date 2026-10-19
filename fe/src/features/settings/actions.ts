"use server";

import { updateCompanySettingsInputSchema } from "@/lib/validators/settings";
import * as companySettings from "@/mocks/services/company-settings";
import { defineAction } from "@/server/actions/define-action";

/** Settings → Empresa (PRD §8.15): replaces the company profile; logged as `SETTINGS_CHANGE`. */
export const updateCompanySettingsAction = defineAction({
  permission: { action: "update", resource: "settings" },
  input: updateCompanySettingsInputSchema,
  revalidate: ["/settings/company"],
  handler: (ctx, data) => companySettings.updateCompanySettings(ctx, data),
});
