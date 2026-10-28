import "server-only";
import {
  findSettingsSection,
  isSettingsSectionVisible,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/config/settings-nav";
import * as companySettings from "@/mocks/services/company-settings";
import { getServiceContext } from "@/server/context";

/** The Configuración sections the signed-in user may see, in §8.15 order. */
export async function getVisibleSettingsSections(): Promise<SettingsSection[]> {
  const ctx = await getServiceContext();
  return SETTINGS_SECTIONS.filter((section) => isSettingsSectionVisible(section, ctx.user));
}

/** The section behind `/settings/<slug>` when the signed-in user may open it; `null` otherwise. */
export async function getOpenableSettingsSection(slug: string): Promise<SettingsSection | null> {
  const section = findSettingsSection(slug);
  if (!section) return null;
  const ctx = await getServiceContext();
  return isSettingsSectionVisible(section, ctx.user) ? section : null;
}

/** The company profile (name, legal name, RIF, address, logo) for Settings → Empresa. */
export async function getCompanySettings() {
  return companySettings.getCompanySettings(await getServiceContext());
}
