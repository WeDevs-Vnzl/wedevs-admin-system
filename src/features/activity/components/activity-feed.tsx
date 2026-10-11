"use client";

import { History } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { EmptyState } from "@/components/patterns/empty-state";
import { Button } from "@/components/ui/button";
import { BUSINESS_TIME_ZONE, formatDate, toDateOnly, type DateOnly } from "@/lib/dates";
import type { ActivityFilterInput, ActivityListRowDTO } from "@/lib/validators/activity";
import type { Paginated } from "@/lib/validators/common";
import { listActivityAction } from "../actions";
import { ActivityDetailSheet } from "./activity-detail-sheet";
import { ActivityItem } from "./activity-item";

/** Groups entries by their Caracas calendar day, keeping the newest-first order of the input. */
export function groupActivityByDay(
  items: readonly ActivityListRowDTO[],
  timeZone: string = BUSINESS_TIME_ZONE,
): { day: DateOnly; items: ActivityListRowDTO[] }[] {
  const groups: { day: DateOnly; items: ActivityListRowDTO[] }[] = [];
  for (const item of items) {
    const day = toDateOnly(new Date(item.createdAt), timeZone);
    const last = groups.at(-1);
    if (last && last.day === day) last.items.push(item);
    else groups.push({ day, items: [item] });
  }
  return groups;
}

/**
 * The timeline: entries grouped by day, a detail sheet per entry and "Cargar más" through the read action.
 * `key` the feed by its filter in the parent so a new filter starts from its own first page.
 */
export function ActivityFeed({
  initial,
  filter,
}: {
  initial: Paginated<ActivityListRowDTO>;
  filter: ActivityFilterInput;
}) {
  const locale = useLocale();
  const t = useTranslations("activity.feed");
  const [items, setItems] = useState(initial.items);
  const [page, setPage] = useState(initial.page);
  const [pageCount, setPageCount] = useState(initial.pageCount);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [selected, setSelected] = useState<ActivityListRowDTO | null>(null);
  // The sheet opens programmatically (no Radix trigger), so the opener is remembered to give focus back.
  const triggerRef = useRef<HTMLElement | null>(null);

  async function loadMore() {
    setLoading(true);
    setFailed(false);
    const result = await listActivityAction({
      ...filter,
      page: page + 1,
      pageSize: initial.pageSize,
    });
    setLoading(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setItems((current) => [...current, ...result.data.items]);
    setPage(result.data.page);
    setPageCount(result.data.pageCount);
  }

  if (items.length === 0) {
    return <EmptyState icon={History} title={t("empty")} description={t("emptyDescription")} />;
  }

  return (
    <div className="flex flex-col gap-6">
      {groupActivityByDay(items).map((group) => {
        const label = formatDate(group.day, locale, "long");
        return (
          <section
            key={group.day}
            aria-label={t("group", { day: label })}
            className="flex flex-col gap-3"
          >
            <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
            <ol className="flex flex-col gap-2">
              {group.items.map((entry) => (
                <li key={entry.id}>
                  <ActivityItem
                    entry={entry}
                    onOpen={(opened, trigger) => {
                      triggerRef.current = trigger;
                      setSelected(opened);
                    }}
                  />
                </li>
              ))}
            </ol>
          </section>
        );
      })}

      {page < pageCount ? (
        <div className="flex flex-col items-center gap-2">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
            {loading ? t("loadingMore") : t("loadMore")}
          </Button>
          {failed ? (
            <p role="alert" className="text-sm text-destructive">
              {t("loadError")}
            </p>
          ) : null}
        </div>
      ) : null}

      <ActivityDetailSheet
        entry={selected}
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        onCloseAutoFocus={(event) => {
          const trigger = triggerRef.current;
          if (!trigger?.isConnected) return;
          event.preventDefault();
          trigger.focus();
        }}
      />
    </div>
  );
}
