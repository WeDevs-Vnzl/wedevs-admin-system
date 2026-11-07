"use client";

import { ExternalLink, Lock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import Link from "next/link";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatDateTime } from "@/lib/dates";
import { entityHref } from "@/lib/entity-routes";
import type { ActivityRow } from "@/lib/api/types/activity";
import { knownEntityType } from "../entity-type";
import { ActivityDiff } from "./activity-diff";

/** The browser family of a user agent, as a key of `activity.browser` (`null` when there is no agent). */
export function browserKey(
  userAgent: string | null,
): "edge" | "firefox" | "chrome" | "safari" | "other" | null {
  if (!userAgent) return null;
  if (/Edg\//.test(userAgent)) return "edge";
  if (/Firefox\//.test(userAgent)) return "firefox";
  if (/Chrome\/|CriOS\//.test(userAgent)) return "chrome";
  if (/Safari\//.test(userAgent)) return "safari";
  return "other";
}

/** One event: its field diff, technical context, the link to its record and the immutability note. */
export function ActivityDetailSheet({
  entry: entryProp,
  open,
  onOpenChange,
  onCloseAutoFocus,
}: {
  entry: ActivityRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Where focus goes when the sheet closes; the opener is not a Radix trigger, so the parent restores it. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("activity");
  const tEnums = useTranslations("enums");
  const tBrowser = useTranslations("activity.browser");
  // Keeps the last entry while the sheet closes, so the exit animation does not cut to empty.
  const [lastEntry, setLastEntry] = useState(entryProp);
  if (entryProp && entryProp !== lastEntry) setLastEntry(entryProp);
  const entry = entryProp ?? lastEntry;
  if (!entry) return null;

  const entityType = knownEntityType(entry.entityType);
  const href = entityType ? entityHref({ type: entityType, id: entry.entityId }) : null;
  const browser = browserKey(entry.userAgent);
  // The IP arrives already masked from the BE (PRD §8.14, BE-2 choice 5); it is shown as received.
  const ip = entry.ip;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="overflow-y-auto" onCloseAutoFocus={onCloseAutoFocus}>
        <SheetHeader>
          <SheetTitle>{t(`summary.${entry.action}`, { entity: entry.entityLabel })}</SheetTitle>
          <SheetDescription>
            {formatDateTime(new Date(entry.createdAt), locale, "medium")}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-6">
          <section aria-labelledby="activity-changes" className="flex flex-col gap-3">
            <h3 id="activity-changes" className="text-sm font-semibold">
              {t("diff.title")}
            </h3>
            {entry.changes ? (
              <ActivityDiff entityType={entry.entityType} changes={entry.changes} />
            ) : (
              <p className="text-sm text-muted-foreground">{t("detail.noChanges")}</p>
            )}
          </section>

          <Separator />

          <section aria-labelledby="activity-technical" className="flex flex-col gap-3">
            <h3 id="activity-technical" className="text-sm font-semibold">
              {t("detail.technical")}
            </h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">{t("detail.action")}</dt>
              <dd>
                <Badge variant="secondary">{tEnums(`ActivityAction.${entry.action}`)}</Badge>
              </dd>
              {ip ? (
                <>
                  <dt className="text-muted-foreground">{t("detail.ip")}</dt>
                  <dd className="font-mono tabular-nums">{ip}</dd>
                </>
              ) : null}
              {browser ? (
                <>
                  <dt className="text-muted-foreground">{t("detail.browser")}</dt>
                  <dd>{tBrowser(browser)}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">{t("detail.eventId")}</dt>
              <dd className="font-mono break-all">{entry.id}</dd>
            </dl>
          </section>

          <section aria-labelledby="activity-entity" className="flex flex-col gap-3">
            <h3 id="activity-entity" className="sr-only">
              {t("detail.entity")}
            </h3>
            {href ? (
              <Link
                href={href}
                className="inline-flex items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline"
              >
                <EntityCodeChip code={entry.entityLabel} />
                {t("detail.openEntity")}
                <ExternalLink aria-hidden className="size-4" />
              </Link>
            ) : null}
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Lock aria-hidden className="mt-0.5 size-3.5 shrink-0" />
              {t("detail.immutable")}
            </p>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
