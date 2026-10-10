// MOCK — activity and alert-state fixtures of Hito 1 (data-rules.md §2). Typed empty stubs: the module
// packages that build the activity log and the alerts fill them (including `SYSTEM` and `PUBLIC` actors)
// and own this file from then on.
import type { ActivityEntryDTO } from "@/lib/validators/activity";
import type { AlertDismissalDTO } from "@/lib/validators/alerts";

/** Per-user alert dismissal or snooze (`AlertDismissal` in Hito 2). */
export interface AlertDismissalRow extends AlertDismissalDTO {
  userId: string;
}

export const activityFixtures: ActivityEntryDTO[] = [];
export const alertDismissalFixtures: AlertDismissalRow[] = [];
