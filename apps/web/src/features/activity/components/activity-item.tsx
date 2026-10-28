"use client";

import { Bot, ChevronRight, Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { EntityCodeChip } from "@/components/patterns/entity-code-chip";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import { BUSINESS_TIME_ZONE } from "@/lib/dates";
import { entityHref } from "@/lib/entity-routes";
import type { ActivityListRowDTO } from "@/lib/validators/activity";

/** Clock time of an instant in the business zone (Caracas), `HH:mm` in the locale's style. */
export function formatActivityTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: BUSINESS_TIME_ZONE,
  }).format(new Date(iso));
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** One entry of the timeline: who, when, what, on which record. Read-only: no edit or delete (HU-29 CA2). */
export function ActivityItem({
  entry,
  onOpen,
}: {
  entry: ActivityListRowDTO;
  onOpen: (entry: ActivityListRowDTO, trigger: HTMLElement) => void;
}) {
  const locale = useLocale();
  const t = useTranslations("activity");
  const tEnums = useTranslations("enums");
  const href = entityHref({ type: entry.entityType, id: entry.entityId });
  const actionLabel = tEnums(`ActivityAction.${entry.action}`);
  const { actor } = entry;

  return (
    <Item size="sm" className="rounded-none px-0">
      <ItemMedia>
        {actor.type === "USER" ? (
          <Avatar size="sm">
            {actor.imageUrl ? <AvatarImage src={actor.imageUrl} alt="" /> : null}
            <AvatarFallback>{initials(actor.name ?? "?")}</AvatarFallback>
          </Avatar>
        ) : (
          <span className="flex size-8 items-center justify-center rounded-full bg-muted text-muted-foreground">
            {actor.type === "SYSTEM" ? (
              <Bot aria-hidden className="size-4" />
            ) : (
              <Globe aria-hidden className="size-4" />
            )}
          </span>
        )}
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="flex flex-wrap items-center gap-2">
          <span>
            {actor.type === "USER"
              ? (actor.name ?? t("actor.unknown"))
              : actor.type === "SYSTEM"
                ? t("actor.system")
                : t("actor.public")}
          </span>
          <Badge variant="secondary">{actionLabel}</Badge>
          <span className="font-normal text-muted-foreground tabular-nums">
            <time dateTime={entry.createdAt}>{formatActivityTime(entry.createdAt, locale)}</time>
          </span>
        </ItemTitle>
        <ItemDescription className="flex flex-wrap items-center gap-2">
          <span>{t(`summary.${entry.action}`, { entity: entry.entityLabel })}</span>
          {href ? (
            <Link
              href={href}
              className="rounded-md focus-visible:ring-2 focus-visible:outline-none"
            >
              <EntityCodeChip code={entry.entityLabel} />
            </Link>
          ) : (
            <EntityCodeChip code={entry.entityLabel} />
          )}
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t("feed.viewDetail", { action: actionLabel })}
          onClick={(event) => onOpen(entry, event.currentTarget)}
        >
          <ChevronRight aria-hidden />
        </Button>
      </ItemActions>
    </Item>
  );
}
