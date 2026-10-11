"use client";

import {
  BadgeDollarSign,
  CalendarClock,
  CircleDollarSign,
  FileClock,
  FileWarning,
  FileX,
  Hourglass,
  Receipt,
  Repeat,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { entityHref } from "@/lib/entity-routes";
import type { AlertDTO, AlertType } from "@/lib/validators/alerts";
import { cn } from "@/lib/utils";
import { AlertSnoozeMenu } from "./alert-snooze-menu";

export const ALERT_ICONS: Record<AlertType, LucideIcon> = {
  INVOICE_OVERDUE: FileWarning,
  INVOICE_DUE_SOON: CalendarClock,
  INSTALLMENT_TO_INVOICE: Receipt,
  DOCUMENT_EXPIRING: FileClock,
  DOCUMENT_EXPIRED: FileX,
  RECURRING_EXPENSE_PENDING: Repeat,
  PAYMENT_PENDING_VERIFICATION: Hourglass,
  UNALLOCATED_CREDIT: BadgeDollarSign,
  MISSING_RATE: CircleDollarSign,
};

/** The missing rate has no record to open: it points at the rates screen. */
const MISSING_RATE_HREF = "/settings/rates";

export interface AlertItemProps {
  alert: AlertDTO;
  compact?: boolean;
  busy?: boolean;
  onDismiss: (alert: AlertDTO) => void;
  onSnooze: (alert: AlertDTO, days: number) => void;
}

export function AlertItem({ alert, compact = false, busy, onDismiss, onSnooze }: AlertItemProps) {
  const t = useTranslations("alerts");
  const Icon = ALERT_ICONS[alert.type];
  const title = t(`types.${alert.type}.title`);
  const days = alert.days ?? 0;
  const when = t(`types.${alert.type}.when`, {
    state: days < 0 ? "past" : days === 0 ? "today" : "future",
    days: Math.abs(days),
  });
  const href = alert.entity ? entityHref(alert.entity) : alert.type === "MISSING_RATE" ? MISSING_RATE_HREF : null;
  const subject = [alert.entity?.label, alert.context].filter(Boolean).join(" · ");

  return (
    <Item variant="outline" size="sm" className={cn(compact && "flex-nowrap")} data-alert-key={alert.alertKey}>
      <ItemMedia variant="icon">
        <Icon aria-hidden />
      </ItemMedia>
      <ItemContent>
        <ItemTitle>
          {href ? (
            <Link href={href} className="hover:underline focus-visible:underline">
              {title}
            </Link>
          ) : (
            title
          )}
        </ItemTitle>
        <ItemDescription className={cn(compact && "line-clamp-2")}>
          {subject ? <span className="block">{subject}</span> : null}
          <span className="block">
            {when}
            {alert.date ? (
              <>
                {" · "}
                <DateText value={alert.date} />
              </>
            ) : null}
            {alert.amount ? (
              <>
                {" · "}
                <MoneyText amount={alert.amount.amount} currency={alert.amount.currency} className="font-medium" />
              </>
            ) : null}
          </span>
        </ItemDescription>
      </ItemContent>
      <ItemActions>
        <AlertSnoozeMenu title={title} disabled={busy} onSnooze={(d) => onSnooze(alert, d)} />
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label={`${t("actions.dismiss")}: ${title}`}
          onClick={() => onDismiss(alert)}
        >
          <X aria-hidden />
        </Button>
      </ItemActions>
    </Item>
  );
}
