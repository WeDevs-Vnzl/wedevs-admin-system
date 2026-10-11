/**
 * Values of `?tab=` on the project detail (PRD §8.2), in display order and in English like the clients detail.
 * The finance tabs (`billing`, `invoices`, `expenses`) and `activity` exist only for the roles that may open
 * them; any other value falls back to `summary`.
 */
export const PROJECT_DETAIL_TAB_VALUES = [
  "summary",
  "links",
  "billing",
  "invoices",
  "expenses",
  "documents",
  "notes",
  "activity",
] as const;

export type ProjectDetailTab = (typeof PROJECT_DETAIL_TAB_VALUES)[number];

export const DEFAULT_PROJECT_DETAIL_TAB: ProjectDetailTab = "summary";

/** `?tab=` value → a known tab, else `summary`. */
export function parseProjectDetailTab(value: unknown): ProjectDetailTab {
  return PROJECT_DETAIL_TAB_VALUES.find((tab) => tab === value) ?? DEFAULT_PROJECT_DETAIL_TAB;
}

/** URL of a project detail tab (`summary` is the bare detail URL). */
export function projectDetailTabHref(id: string, tab: ProjectDetailTab): string {
  return tab === DEFAULT_PROJECT_DETAIL_TAB ? `/projects/${id}` : `/projects/${id}?tab=${tab}`;
}
