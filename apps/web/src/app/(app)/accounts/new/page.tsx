import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AccountForm } from "@/features/accounts/components/account-form";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { listCurrencies } from "@/features/catalogs/queries";
import { requireSessionUser } from "@/server/auth/session";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts.page");
  return { title: t("newTitle") };
}

// `/accounts/new` (PRD §8.7). Only roles that may create an account get the form.
export default async function NewAccountPage() {
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const currencies = await listCurrencies();

  return <AccountForm currencies={currencies.map(({ code, name }) => ({ code, name }))} />;
}
