/**
 * Tabs of the client detail (PRD §8.2, frontend-patterns §4), in display order. A tab a role may not open is
 * left out entirely, so its content is never rendered for that role.
 */
export const CLIENT_DETAIL_TAB_VALUES = [
  "summary",
  "contacts",
  "projects",
  "invoices",
  "payments",
  "documents",
  "notes",
  "activity",
] as const;

export type ClientDetailTab = (typeof CLIENT_DETAIL_TAB_VALUES)[number];

export function visibleClientDetailTabs(access: {
  canSeeFinancials: boolean;
  canReadActivity: boolean;
}): ClientDetailTab[] {
  return CLIENT_DETAIL_TAB_VALUES.filter((tab) => {
    if (tab === "invoices" || tab === "payments") return access.canSeeFinancials;
    if (tab === "activity") return access.canReadActivity;
    return true;
  });
}
