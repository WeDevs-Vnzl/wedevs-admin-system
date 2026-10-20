// MOCK — the fixed business day the finance fixtures (invoices, billing) are written against, next to the fixed
// dates of the payments and expenses fixtures. A real-clock anchor made the derived figures drift every day.
import type { DateOnly } from "@/lib/dates";

export const SEED_DAY: DateOnly = "2026-10-19";
