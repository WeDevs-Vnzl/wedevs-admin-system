import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { AccountForm } from "@/features/accounts/components/account-form";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { getAccount, getAccountLedger } from "@/features/accounts/queries";
import { listCurrencies } from "@/features/catalogs/queries";
import { requireSessionUser } from "@/server/auth/session";
import { ServiceError } from "@/server/errors";
import type { AccountDTO } from "@/lib/validators/accounts";

type AccountEditPageProps = {
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

export async function generateMetadata({ params }: AccountEditPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("accounts.page");
  const account = await readAccount(id);
  return { title: account ? t("editTitle", { name: account.name }) : t("title") };
}

// `/accounts/[id]/edit` (PRD §8.7). Roles that may not update accounts and unknown ids get the not-found page.
// The currency is locked once the account has movements: the ledger always starts with the opening row.
export default async function AccountEditPage({ params }: AccountEditPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canUpdate) notFound();
  const account = await readAccount(id);
  if (!account) notFound();
  const [ledger, currencies] = await Promise.all([
    getAccountLedger({ accountId: account.id, pageSize: 25 }),
    listCurrencies(),
  ]);

  return (
    <>
      <BreadcrumbLabel segment={account.id} label={account.name} />
      <AccountForm
        account={account}
        currencies={currencies.map(({ code, name }) => ({ code, name }))}
        currencyLocked={ledger.total > 1}
      />
    </>
  );
}
