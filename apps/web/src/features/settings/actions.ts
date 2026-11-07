"use server";

import { apiAction } from "@/lib/api/action";
import type { UpdateCompanySettingsInput } from "@/lib/validators/settings";
import { mapCompanyResult } from "./company";

/**
 * Settings → Empresa (PRD §8.15): `PATCH /settings/company` replaces the profile (an omitted optional field is
 * cleared, so removing the logo just omits `logoFileId`). The BE `can()` decides who may update it.
 */
export const updateCompanySettingsAction = apiAction({
  call: async (input: UpdateCompanySettingsInput, api) =>
    mapCompanyResult(await api.PATCH("/api/v1/settings/company", { body: input })),
  revalidate: ["/settings/company"],
});
