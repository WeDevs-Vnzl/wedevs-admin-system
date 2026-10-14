import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountsOverview } from "@/features/accounts/components/accounts-overview";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { getAccountsOverview } from "@/features/accounts/queries";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts.page");
  return { title: t("overviewTitle") };
}

// `/accounts` (PRD §8.7 "Overview", DT-25: the overview is not the list). Owner and Admin only; other roles get
// the not-found page. Balances come from the service, derived through `lib/finance` (C17).
export default async function AccountsOverviewPage() {
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const overview = await getAccountsOverview();

  return <AccountsOverview overview={overview} permissions={permissions} />;
}
