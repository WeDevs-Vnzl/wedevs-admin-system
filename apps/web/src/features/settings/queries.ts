import "server-only";
import {
  findSettingsSection,
  isSettingsSectionVisible,
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/config/settings-nav";
import { toActionResult } from "@/lib/api/errors";
import { getServerApi } from "@/lib/api/server";
import { requireSessionUser } from "@/lib/auth/session";
import { getFeatures } from "@/features/shell/features";
import { toCompanySettings } from "./company";
import { unwrapOrBoundary } from "./query-boundary";

/** The Configuración sections the signed-in user may see, in §8.15 order (feature flags applied, DT-227). */
export async function getVisibleSettingsSections(): Promise<SettingsSection[]> {
  const user = await requireSessionUser();
  const features = await getFeatures();
  return SETTINGS_SECTIONS.filter((section) => isSettingsSectionVisible(section, user, features));
}

/** The section behind `/settings/<slug>` when the signed-in user may open it; `null` otherwise. */
export async function getOpenableSettingsSection(slug: string): Promise<SettingsSection | null> {
  const section = findSettingsSection(slug);
  if (!section) return null;
  const user = await requireSessionUser();
  return isSettingsSectionVisible(section, user, await getFeatures()) ? section : null;
}

/** The company profile (name, legal name, RIF, address, logo) for Settings → Empresa. */
export async function getCompanySettings() {
  const api = await getServerApi();
  return toCompanySettings(
    unwrapOrBoundary(toActionResult(await api.GET("/api/v1/settings/company"))),
  );
}
