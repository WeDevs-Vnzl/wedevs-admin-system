"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DateText } from "@/components/patterns/date-text";
import { MoneyText } from "@/components/patterns/money-text";
import { entityHref } from "@/lib/entity-routes";
import type { EntityRef } from "@/lib/validators/common";
import type { DashboardDTO } from "@/lib/validators/dashboard";
import { DashboardPanel, PanelList } from "./dashboard-panel";

/** An entity's code (mono, muted) and name, linked to its detail when it has a route of its own. */
function EntityLink({ entity, showLabel = true }: { entity: EntityRef; showLabel?: boolean }) {
  const href = entityHref(entity);
  const content: ReactNode = (
    <>
      {entity.code ? (
        <span className="font-mono text-xs text-muted-foreground">{entity.code}</span>
      ) : null}
      {entity.code && showLabel ? " " : null}
      {showLabel || !entity.code ? entity.label : null}
    </>
  );
  return href ? (
    <Link href={href} className="hover:underline">
      {content}
    </Link>
  ) : (
    <span>{content}</span>
  );
}

export function InvoicesDuePanel({ rows }: { rows: DashboardDTO["invoicesDue"] }) {
  const t = useTranslations("dashboard.panels.invoicesDue");
  return (
    <DashboardPanel title={t("title")}>
      <PanelList
        emptyTitle={t("empty")}
        rows={rows.map((row) => ({
          id: row.invoice.id,
          primary: (
            <>
              <EntityLink entity={row.invoice} showLabel={false} />{" "}
              <span className="font-normal">{row.client.label}</span>
            </>
          ),
          secondary: (
            <span className={row.daysUntilDue < 0 ? "text-destructive" : undefined}>
              {row.daysUntilDue < 0
                ? t("overdue", { days: -row.daysUntilDue })
                : t("dueIn", { days: row.daysUntilDue })}
            </span>
          ),
          value: <MoneyText amount={row.balanceUsd} currency="USD" />,
        }))}
      />
    </DashboardPanel>
  );
}

export function InstallmentsPanel({ rows }: { rows: DashboardDTO["installmentsToInvoice"] }) {
  const t = useTranslations("dashboard.panels.installments");
  return (
    <DashboardPanel title={t("title")}>
      <PanelList
        emptyTitle={t("empty")}
        rows={rows.map((row) => ({
          id: row.installment.id,
          primary: row.installment.label,
          secondary: (
            <>
              <EntityLink entity={row.project} /> ·{" "}
              {row.dueDate ? <DateText value={row.dueDate} /> : t("noDate")}
            </>
          ),
          value: <MoneyText amount={row.amount} currency={row.currency} />,
        }))}
      />
    </DashboardPanel>
  );
}

export function DocumentsExpiringPanel({ rows }: { rows: DashboardDTO["documentsExpiring"] }) {
  const t = useTranslations("dashboard.panels.documents");
  return (
    <DashboardPanel title={t("title")}>
      <PanelList
        emptyTitle={t("empty")}
        rows={rows.map((row) => ({
          id: row.document.id,
          primary: <EntityLink entity={row.document} />,
          secondary: <DateText value={row.expiresAt} />,
          value: <span className="text-xs">{t("daysLeft", { days: row.daysLeft })}</span>,
        }))}
      />
    </DashboardPanel>
  );
}

export function RecurringExpensesPanel({
  rows,
}: {
  rows: DashboardDTO["upcomingRecurringExpenses"];
}) {
  const t = useTranslations("dashboard.panels.recurring");
  return (
    <DashboardPanel title={t("title")}>
      <PanelList
        emptyTitle={t("empty")}
        rows={rows.map((row) => ({
          id: `${row.expense.id}-${row.dueDate}`,
          primary: <EntityLink entity={row.expense} />,
          secondary: <DateText value={row.dueDate} />,
          value: <MoneyText amount={row.amountUsd} currency="USD" />,
        }))}
      />
    </DashboardPanel>
  );
}

export function RecentActivityPanel({ rows }: { rows: DashboardDTO["recentActivity"] }) {
  const t = useTranslations("dashboard.panels.activity");
  const tAction = useTranslations("enums.ActivityAction");
  return (
    <DashboardPanel title={t("title")}>
      <PanelList
        emptyTitle={t("empty")}
        rows={rows.map((row) => ({
          id: row.id,
          primary: <span>{row.actorName ?? t("system")}</span>,
          secondary: (
            <>
              {tAction(row.action)}
              {row.entity ? (
                <>
                  {" "}
                  <EntityLink entity={row.entity} />
                </>
              ) : null}
            </>
          ),
          value: (
            <DateText value={new Date(row.createdAt)} className="text-xs text-muted-foreground" />
          ),
        }))}
      />
    </DashboardPanel>
  );
}
