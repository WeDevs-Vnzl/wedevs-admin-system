import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { PaymentForm } from "@/features/payments/components/payment-form";
import { getPaymentFormOptions } from "@/features/payments/form-options";
import { paymentScreenPermissions } from "@/features/payments/permissions";
import { getPayment } from "@/features/payments/queries";
import { notFoundWhenRefused, orNullWhenMissing } from "@/features/payments/refusal";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

type PaymentEditPageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.page");
  return { title: t("editTitle") };
}

// `/payments/[id]/edit` (Q-FEINT-11 (A), DT-213): the payment form over `PATCH /payments/{id}`. Roles that may not
// update payments and unknown ids get the not-found page. A voided payment takes no edit, so its route goes back to
// the detail (rule 21); the BE refusal (`payments.errors.voided`) stays mapped for the race.
export default async function PaymentEditPage({ params }: PaymentEditPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = paymentScreenPermissions(user);
  if (!permissions.canUpdate) notFound();
  const payment = await notFoundWhenRefused(
    async () => (await orNullWhenMissing(() => getPayment(id))) ?? notFound(),
  );
  if (payment.status === "ANULADO") redirect(`/payments/${payment.id}`);
  const options = await notFoundWhenRefused(() => getPaymentFormOptions({ includeInactive: true }));

  return (
    <>
      <BreadcrumbLabel segment={payment.id} label={payment.code} />
      <PaymentForm {...options} today={todayInCaracas(new Date())} payment={payment} />
    </>
  );
}
