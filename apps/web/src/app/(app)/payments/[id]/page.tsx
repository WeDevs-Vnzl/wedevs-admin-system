import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { BreadcrumbLabel } from "@/components/app/breadcrumb-label";
import { MoneyText } from "@/components/patterns/money-text";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { catalogLabel } from "@/features/catalogs/components/catalog-label";
import { PaymentAllocationsPanel } from "@/features/payments/components/payment-allocations-panel";
import { PaymentDetailHeader } from "@/features/payments/components/payment-detail-header";
import { PaymentReceipt } from "@/features/payments/components/payment-receipt";
import { paymentScreenPermissions } from "@/features/payments/permissions";
import { getPayment } from "@/features/payments/queries";
import {
  notFoundWhenRefused,
  orNullWhenMissing,
  orNullWhenUnavailable,
} from "@/features/payments/refusal";
import { requireSessionUser } from "@/server/auth/session";

type PaymentDetailPageProps = {
  params: Promise<{ id: string }>;
};

// An unknown id is `null`; a `FORBIDDEN` from the BE is the same not-found page (C13).
const readPayment = (id: string) => orNullWhenMissing(() => getPayment(id));

export async function generateMetadata({ params }: PaymentDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const t = await getTranslations("payments.page");
  const payment = await orNullWhenUnavailable(() => getPayment(id));
  return { title: payment ? payment.code : t("detailTitle") };
}

// `/payments/[id]` (HU-13, HU-14): the amounts as they entered the account, the invoices the payment is applied
// to, and the receipt viewed in place. Unknown ids and roles without the payment grant get the not-found page.
export default async function PaymentDetailPage({ params }: PaymentDetailPageProps) {
  const { id } = await params;
  const user = await requireSessionUser();
  const permissions = paymentScreenPermissions(user);
  if (!permissions.canRead) notFound();
  const payment = await notFoundWhenRefused(async () => (await readPayment(id)) ?? notFound());

  const [t, tPayments, locale] = await Promise.all([
    getTranslations("payments.detail"),
    getTranslations("payments"),
    getLocale(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <BreadcrumbLabel segment={payment.id} label={payment.code} />
      <PaymentDetailHeader
        canUpdate={permissions.canUpdate}
        payment={{
          id: payment.id,
          code: payment.code,
          status: payment.status,
          description: [payment.client.label, catalogLabel(payment.method, locale)]
            .filter(Boolean)
            .join(" · "),
        }}
      />

      <div className="grid gap-4 @lg:grid-cols-3">
        <Card className="@lg:col-span-2">
          <CardHeader>
            <CardTitle>{t("summary")}</CardTitle>
            <CardDescription>{t("summaryDescription")}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm @md:grid-cols-3">
            <AmountItem
              label={t("amounts.amount")}
              amount={payment.amount}
              currency={payment.currency}
            />
            <AmountItem
              label={t("amounts.igtf")}
              amount={payment.igtfAmount}
              currency={payment.currency}
            />
            <AmountItem
              label={t("amounts.fee")}
              amount={payment.feeAmount}
              currency={payment.currency}
            />
            <AmountItem
              label={t("amounts.netCredited")}
              amount={payment.netCredited}
              currency={payment.currency}
            />
            <AmountItem
              label={t("amounts.allocatable")}
              amount={payment.allocatable}
              currency={payment.currency}
            />
            <AmountItem
              label={t("amounts.allocated")}
              amount={payment.allocated}
              currency={payment.currency}
            />
            <AmountItem
              label={t("amounts.unallocated")}
              amount={payment.unallocated}
              currency={payment.currency}
            />
            <AmountItem label={t("amounts.usd")} amount={payment.amountUsd} currency="USD" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("dataTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            <DataItem label={t("fields.client")} value={payment.client.label} />
            <DataItem label={t("fields.date")} value={payment.date} />
            <DataItem label={t("fields.account")} value={payment.account.label} />
            <DataItem label={t("fields.method")} value={catalogLabel(payment.method, locale)} />
            <DataItem label={t("fields.reference")} value={payment.reference ?? "—"} />
            <DataItem label={t("fields.usdRate")} value={payment.usdRate} />
            <DataItem label={tPayments("table.columns.status")} value={payment.status} />
          </CardContent>
        </Card>
      </div>

      <PaymentAllocationsPanel payment={payment} canUpdate={permissions.canUpdate} />

      <PaymentReceipt receipt={payment.receipt} />
    </div>
  );
}

function AmountItem({
  label,
  amount,
  currency,
}: {
  label: string;
  amount: string;
  currency: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <MoneyText amount={amount} currency={currency} />
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
