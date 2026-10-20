"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { StatusBadge } from "@/components/patterns/status-badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Paginated } from "@/lib/validators/common";
import { SHARE_EVENT_VALUES, type ShareEvent } from "@/lib/validators/enums";
import type { ShareAccessLogRowDTO } from "@/lib/validators/shares";
import { listShareAccessLogAction } from "../actions";

const ALL = "__all__";

interface ShareAccessLogProps {
  shareLinkId: string;
  /** First page, newest first, read on the server. */
  initial: Paginated<ShareAccessLogRowDTO>;
}

/**
 * Access table of a link (PRD §8.11 "Trazabilidad"): date, event (views, downloads, unlocks and failed unlocks),
 * document, visitor fingerprint (never the IP) and browser. Paging and the event filter reload through the action.
 */
export function ShareAccessLog({ shareLinkId, initial }: ShareAccessLogProps) {
  const t = useTranslations("shares.detail.accessLog");
  const [page, setPage] = useState(initial);
  const [event, setEvent] = useState<ShareEvent | null>(null);
  const [pending, startTransition] = useTransition();

  function load(nextPage: number, nextEvent: ShareEvent | null) {
    startTransition(async () => {
      const result = await listShareAccessLogAction({
        shareLinkId,
        page: nextPage,
        pageSize: initial.pageSize,
        sort: "createdAt:desc",
        ...(nextEvent ? { event: nextEvent } : {}),
      });
      if (!result.ok) {
        toast.error(t("loadFailed"));
        return;
      }
      setPage(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Select
          value={event ?? ALL}
          onValueChange={(value) => {
            const next = value === ALL ? null : (value as ShareEvent);
            setEvent(next);
            load(1, next);
          }}
        >
          <SelectTrigger size="sm" className="w-48" aria-label={t("eventFilter")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{t("allEvents")}</SelectItem>
            {SHARE_EVENT_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                <EventLabel value={value} />
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Table aria-label={t("title")} aria-busy={pending || undefined}>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.date")}</TableHead>
            <TableHead>{t("columns.event")}</TableHead>
            <TableHead>{t("columns.document")}</TableHead>
            <TableHead>{t("columns.visitor")}</TableHead>
            <TableHead>{t("columns.userAgent")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {page.items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                {t("empty")}
              </TableCell>
            </TableRow>
          ) : (
            page.items.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap">
                  <DateText value={new Date(row.createdAt)} style="short" />
                </TableCell>
                <TableCell>
                  <StatusBadge enumName="ShareEvent" value={row.event} />
                </TableCell>
                <TableCell>{row.documentTitle ?? t("wholeLink")}</TableCell>
                <TableCell className="font-mono text-xs">{row.visitor}</TableCell>
                <TableCell
                  className="max-w-64 truncate text-xs text-muted-foreground"
                  title={row.userAgent ?? undefined}
                >
                  {row.userAgent ?? t("unknownAgent")}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      {page.pageCount > 1 ? (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground tabular-nums">
            {t("pageOf", { page: page.page, pageCount: page.pageCount })}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || page.page <= 1}
            onClick={() => load(page.page - 1, event)}
          >
            {t("previous")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={pending || page.page >= page.pageCount}
            onClick={() => load(page.page + 1, event)}
          >
            {t("next")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function EventLabel({ value }: { value: ShareEvent }) {
  const t = useTranslations("enums.ShareEvent");
  return <>{t(value)}</>;
}
