import { searchableEntityTypeSchema, type SearchableEntityType } from "@/lib/validators/search";

// "Los registros visitados recientemente" of Cmd+K (PRD §7.6). A per-viewer convenience kept in
// `localStorage` per user; it may be empty or unavailable (private mode, blocked storage), so every
// access is guarded and the menu works without it.

export interface RecentRecord {
  entityType: SearchableEntityType;
  entityId: string;
  /** What the menu shows: the hit title or the detail page's breadcrumb label. */
  title: string;
  code: string | null;
  href: string;
}

export const RECENT_RECORDS_MAX = 8;

const storageKey = (userId: string) => `wedevs:recent-records:${userId}`;

function isRecentRecord(value: unknown): value is RecentRecord {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    searchableEntityTypeSchema.safeParse(row.entityType).success &&
    typeof row.entityId === "string" &&
    typeof row.title === "string" &&
    (row.code === null || typeof row.code === "string") &&
    typeof row.href === "string" &&
    row.href.startsWith("/")
  );
}

export function readRecentRecords(userId: string): RecentRecord[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isRecentRecord).slice(0, RECENT_RECORDS_MAX) : [];
  } catch {
    return [];
  }
}

/** Puts the record first (once) and keeps the newest `RECENT_RECORDS_MAX`. */
export function rememberRecentRecord(userId: string, record: RecentRecord): void {
  const rest = readRecentRecords(userId).filter(
    (row) => row.entityType !== record.entityType || row.entityId !== record.entityId,
  );
  try {
    window.localStorage.setItem(
      storageKey(userId),
      JSON.stringify([record, ...rest].slice(0, RECENT_RECORDS_MAX)),
    );
  } catch {
    // Storage unavailable: recents are a convenience, the menu works without them.
  }
}
