import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { TransferForm } from "@/features/accounts/components/transfer-form";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { listAccounts } from "@/features/accounts/queries";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

type TransferNewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts.page");
  return { title: t("transferTitle") };
}

// `/accounts/transfers/new` (HU-16). Roles without the account create grant get the not-found page. The origin
// can be preselected with `?from=`; an unknown or inactive id simply is not in the list.
export default async function NewTransferPage({ searchParams }: TransferNewPageProps) {
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const { from } = await searchParams;
  const page = await listAccounts({ pageSize: 100 });
  const accounts = page.items
    .filter((account) => account.active)
    .map(({ id, name, currency }) => ({ id, name, currency }));

  return (
    <TransferForm
      accounts={accounts}
      today={todayInCaracas(new Date())}
      initialFromAccountId={typeof from === "string" ? from : undefined}
    />
  );
}
