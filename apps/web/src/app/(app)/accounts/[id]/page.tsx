import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight, Pencil, Plus } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { MoneyText } from "@/components/patterns/money-text";
import { PageHeader } from "@/components/patterns/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AccountLedgerTable } from "@/features/accounts/components/account-ledger-table";
import { ReconciliationForm } from "@/features/accounts/components/reconciliation-form";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { getAccount, getAccountLedger } from "@/features/accounts/queries";
import { todayInCaracas } from "@/lib/dates";
import type { AccountDTO } from "@/lib/validators/accounts";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";

type AccountDetailPageProps = {
  params: Promise<{ id: string }>;
};

async function readAccount(id: string): Promise<AccountDTO | null> {
  try {
    return await getAccount(id);
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

export async function generateMetadata({ params }: AccountDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("accounts.page");
  const account = await readAccount(id);
  return { title: account ? account.name : t("title") };
}

// `/accounts/[id]` (HU-15): the balance, the ledger with its running balance (CA2) and the reconciliation that
// suggests an `AJUSTE` for a difference (CA3). Unknown ids and roles without the account grant get not-found.
export default async function AccountDetailPage({ params }: AccountDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const account = await readAccount(id);
  if (!account) notFound();

  const [ledger, t, tEnums] = await Promise.all([
    getAccountLedger({ accountId: account.id, pageSize: 100 }),
    getTranslations("accounts"),
    getTranslations("enums"),
  ]);
  const today = todayInCaracas(new Date());
  const identifier = account.identifierMasked ?? t("detail.noIdentifier");

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={account.id} label={account.name} />
      <PageHeader
        title={account.name}
        description={[tEnums(`AccountType.${account.type}`), account.institution]
          .filter(Boolean)
          .join(" · ")}
        actions={
          permissions.canCreate || permissions.canUpdate ? (
            <div className="flex flex-wrap gap-2">
              {permissions.canUpdate ? (
                <Button variant="outline" asChild>
                  <Link href={`/accounts/${account.id}/edit`}>
                    <Pencil aria-hidden />
                    {t("detail.edit")}
                  </Link>
                </Button>
              ) : null}
              {permissions.canCreate ? (
                <>
                  <Button variant="outline" asChild>
                    <Link href={`/accounts/transfers/new?from=${account.id}`}>
                      <ArrowLeftRight aria-hidden />
                      {t("page.transferAction")}
                    </Link>
                  </Button>
                  <Button variant="outline" asChild>
                    <Link href={`/accounts/movements/new?accountId=${account.id}`}>
                      <Plus aria-hidden />
                      {t("page.movementAction")}
                    </Link>
                  </Button>
                </>
              ) : null}
            </div>
          ) : undefined
        }
      />

      <div className="grid gap-4 @lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>{t("detail.balance")}</CardTitle>
            <CardDescription>{t("detail.balanceDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <MoneyText
              amount={account.balance}
              currency={account.currency}
              className="text-2xl font-semibold"
            />
            {account.balanceUsd === null ? null : (
              <MoneyText
                amount={account.balanceUsd}
                currency="USD"
                className="text-sm text-muted-foreground"
              />
            )}
          </CardContent>
        </Card>
        <Card className="@lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("detail.dataTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm @md:grid-cols-2">
            <DataItem label={t("detail.fields.currency")} value={account.currency} />
            <DataItem label={t("detail.fields.identifier")} value={identifier} />
            <DataItem label={t("detail.fields.holderName")} value={account.holderName ?? "—"} />
            <DataItem label={t("detail.fields.openingBalance")} value={account.openingBalance} />
            <DataItem label={t("detail.fields.openingDate")} value={account.openingDate} />
            <DataItem
              label={t("detail.fields.status")}
              value={account.active ? t("status.active") : t("status.inactive")}
            />
            {account.notes ? (
              <DataItem label={t("detail.fields.notes")} value={account.notes} />
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("ledger.title")}</CardTitle>
          <CardDescription>{t("ledger.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <AccountLedgerTable rows={ledger.items} currency={account.currency} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("reconcile.title")}</CardTitle>
          <CardDescription>{t("reconcile.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          {permissions.canCreate ? (
            <ReconciliationForm accountId={account.id} currency={account.currency} today={today} />
          ) : (
            <p className="text-sm text-muted-foreground">{t("reconcile.readOnly")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function DataItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="break-words">{value}</span>
    </div>
  );
}
