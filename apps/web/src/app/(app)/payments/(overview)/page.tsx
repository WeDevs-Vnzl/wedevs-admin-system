import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PaymentsOverview } from "@/features/payments/components/payments-overview";
import { paymentScreenPermissions } from "@/features/payments/permissions";
import { getPaymentsOverview, listPayments } from "@/features/payments/queries";
import { notFoundWhenRefused } from "@/features/payments/refusal";
import { requireSessionUser } from "@/server/auth/session";

/** Rows of the "with credit" aside: a short queue, the full list is one click away. */
const WITH_CREDIT_LIMIT = 5;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.page");
  return { title: t("overviewTitle") };
}

// `/payments` (DT-25): the overview, not the table. Roles without the payment read grant, and a `FORBIDDEN` from
// the BE, get the not-found page. The figures come from `GET /payments/overview` (DT-175).
export default async function PaymentsOverviewPage() {
  const user = await requireSessionUser();
  const permissions = paymentScreenPermissions(user);
  if (!permissions.canRead) notFound();
  // A `FORBIDDEN` from the BE (DT-175, C13) is the same not-found page as the cosmetic gate above.
  const [overview, withCredit] = await notFoundWhenRefused(() =>
    Promise.all([
      getPaymentsOverview(),
      listPayments({
        status: ["CONFIRMADO"],
        hasUnallocated: true,
        sort: "date:desc",
        pageSize: 25,
      }),
    ]),
  );

  return (
    <PaymentsOverview
      overview={overview}
      withCredit={withCredit.items.slice(0, WITH_CREDIT_LIMIT)}
      canCreate={permissions.canCreate}
    />
  );
}
