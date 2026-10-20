import type { Locale } from "@/i18n/config";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";

/**
 * Display name of a technology (DT-72): the English name in English when there is one, the Spanish `name`
 * otherwise. Spanish always shows `name`. Used by the table, the picker and the stack icons, so a rename
 * reaches every screen at once.
 */
export function technologyLabel(
  tech: Pick<TechnologyChipDTO, "name" | "nameEn">,
  locale: Locale,
): string {
  return locale === "en" ? (tech.nameEn ?? tech.name) : tech.name;
}
