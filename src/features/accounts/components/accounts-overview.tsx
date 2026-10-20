import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, Coins, Plus, Wallet, WalletCards } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { MoneyText } from "@/components/patterns/money-text";
import { OverviewLayout } from "@/components/patterns/overview-layout";
import { OverviewTableToggle } from "@/components/patterns/overview-table-toggle";
import { PageHeader } from "@/components/patterns/page-header";
import { RelatedMiniTable } from "@/components/patterns/related-mini-table";
import { StatCard } from "@/components/patterns/stat-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { AccountsOverviewDTO } from "@/lib/validators/accounts";
import type { accountScreenPermissions } from "../permissions";

type AccountsOverviewProps = {
  overview: AccountsOverviewDTO;
  permissions: ReturnType<typeof accountScreenPermissions>;
};

/**
 * `/accounts` overview (DT-25, PRD §8.7, S15) on the overview pattern: the consolidated USD total of the active
 * accounts and the account counts as KPIs, then every account with its balance in its own currency and in USD.
 * The full table with filters lives on `/accounts/list`.
 */
export async function AccountsOverview({ overview, permissions }: AccountsOverviewProps) {
  const t = await getTranslations("accounts");
  const tEnums = await getTranslations("enums");
  const active = overview.accounts.filter((account) => account.active);
  const currencies = new Set(active.map((account) => account.currency));

  const rows = overview.accounts.map((account) => ({
    id: account.id,
    cells: [
      <span key="name" className="flex items-center gap-2">
        <Link href={`/accounts/${account.id}`} className="font-medium hover:underline">
          {account.name}
        </Link>
        {account.active ? null : <Badge variant="outline">{t("status.inactive")}</Badge>}
      </span>,
      <span key="type">
        {tEnums(`AccountType.${account.type}`)}
        {account.institution ? (
          <span className="text-muted-foreground"> · {account.institution}</span>
        ) : null}
      </span>,
      <span key="currency" className="tabular-nums">
        {account.currency}
      </span>,
      <span key="balance" className="block text-right tabular-nums">
        <MoneyText amount={account.balance} currency={account.currency} />
      </span>,
      <span key="usd" className="block text-right tabular-nums">
        {account.balanceUsd === null ? (
          "—"
        ) : (
          <MoneyText amount={account.balanceUsd} currency="USD" />
        )}
      </span>,
    ],
  }));

  return (
    <OverviewLayout
      header={
        <PageHeader
          title={t("page.overviewTitle")}
          description={t("page.description")}
          count={overview.accounts.length}
          views={
            <OverviewTableToggle
              current="overview"
              overviewHref="/accounts"
              tableHref="/accounts/list"
            />
          }
          actions={
            permissions.canCreate ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" asChild>
                  <Link href="/accounts/movements/new">
                    <Plus aria-hidden />
                    {t("page.movementAction")}
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link href="/accounts/transfers/new">
                    <ArrowLeftRight aria-hidden />
                    {t("page.transferAction")}
                  </Link>
                </Button>
                <Button asChild>
                  <Link href="/accounts/new">
                    <Plus aria-hidden />
                    {t("page.newAction")}
                  </Link>
                </Button>
              </div>
            ) : undefined
          }
        />
      }
      kpis={
        <>
          <StatCard
            label={t("overview.totalTitle")}
            value={<MoneyText amount={overview.totalBalanceUsd} currency="USD" />}
            hint={t("overview.totalDescription")}
            icon={Coins}
          />
          <StatCard label={t("overview.kpis.active")} value={active.length} icon={Wallet} />
          <StatCard
            label={t("overview.kpis.inactive")}
            value={overview.accounts.length - active.length}
            icon={WalletCards}
          />
          <StatCard
            label={t("overview.kpis.currencies")}
            value={currencies.size}
            hint={[...currencies].sort().join(" · ") || undefined}
          />
        </>
      }
      main={
        overview.accounts.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={t("overview.empty.title")}
            description={t("overview.empty.description")}
          />
        ) : (
          <RelatedMiniTable
            title={t("overview.accountsTitle")}
            headers={[
              t("table.columns.name"),
              t("table.columns.type"),
              t("table.columns.currency"),
              { label: t("table.columns.balance"), align: "end" },
              { label: t("table.columns.balanceUsd"), align: "end" },
            ]}
            rows={rows}
          />
        )
      }
    />
  );
}
