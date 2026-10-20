import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { MovementForm } from "@/features/accounts/components/movement-form";
import { accountScreenPermissions } from "@/features/accounts/permissions";
import { listAccountPartners, listAccounts } from "@/features/accounts/queries";
import { todayInCaracas } from "@/lib/dates";
import { ACCOUNT_MOVEMENT_TYPE_VALUES, type AccountMovementType } from "@/lib/validators/enums";
import { requireSessionUser } from "@/server/auth/session";

type MovementNewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("accounts.page");
  return { title: t("movementTitle") };
}

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// `/accounts/movements/new` (PRD §8.7). The reconciliation prefills `?accountId=&type=AJUSTE&amount=&date=`; the
// values are only a starting point, the form and the service validate them again.
export default async function NewMovementPage({ searchParams }: MovementNewPageProps) {
  const user = await requireSessionUser();
  const permissions = accountScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const params = await searchParams;
  const type = ACCOUNT_MOVEMENT_TYPE_VALUES.find((value) => value === first(params.type));
  const [page, partners] = await Promise.all([
    listAccounts({ pageSize: 100 }),
    listAccountPartners(),
  ]);
  const accounts = page.items
    .filter((account) => account.active)
    .map(({ id, name, currency }) => ({ id, name, currency }));

  return (
    <MovementForm
      accounts={accounts}
      partners={partners}
      today={todayInCaracas(new Date())}
      initial={{
        accountId: first(params.accountId),
        type: type as AccountMovementType | undefined,
        amount: first(params.amount),
        date: first(params.date),
      }}
    />
  );
}
