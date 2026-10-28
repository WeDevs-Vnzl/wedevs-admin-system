/**
 * Display name of a bilingual catalog row (payment method, expense category): the English name in English
 * when there is one, the Spanish `name` otherwise. Same rule as `technologyLabel` (DT-72).
 */
export function catalogLabel(row: { name: string; nameEn: string | null }, locale: string): string {
  return locale === "en" ? (row.nameEn ?? row.name) : row.name;
}
