"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { MoneyText } from "@/components/patterns/money-text";
import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/dates";
import type { PaymentLinkResponseDto, PaymentLinkStatus } from "@/lib/api/types/payment-links";
import { PaymentLinkCopyButton } from "./payment-links-copy-button";
import { PaymentLinksCreateDialog } from "./payment-links-create-dialog";
import { PaymentLinksDeactivate } from "./payment-links-deactivate";
import { isHttpsUrl, isLinkOpen, supportsPaymentLinks } from "./payment-links-rules";

type PaymentLinksViewProps = {
  invoiceId: string;
  currency: string;
  capacity: string;
  links: PaymentLinkResponseDto[];
  canCreate: boolean;
};

const STATUS_VARIANT: Record<PaymentLinkStatus, "default" | "secondary" | "outline" | "destructive"> = {
  PENDING: "outline",
  ACTIVE: "default",
  COMPLETED: "secondary",
  SETTLED: "secondary",
  DEACTIVATED: "destructive",
};

/** Deactivation reasons the FE knows; the BE sends free text, so anything else shows the generic copy (DT-201). */
const KNOWN_REASONS = ["LINK_EXPIRED"] as const;

/** The list of payment links of an invoice and its create / deactivate actions; every figure is the BE's. */
export function PaymentLinksView({
  invoiceId,
  currency,
  capacity,
  links,
  canCreate,
}: PaymentLinksViewProps) {
  const t = useTranslations("invoices.paymentLinks");
  const tRoot = useTranslations();
  const locale = useLocale();
  const supported = supportsPaymentLinks(currency, capacity);

  function reasonText(reason: string | null): string | null {
    if (reason === null) return null;
    return (KNOWN_REASONS as readonly string[]).includes(reason)
      ? t(`reasons.${reason as (typeof KNOWN_REASONS)[number]}`)
      : t("reasons.generic");
  }

  return (
    <section aria-labelledby="payment-links-title" className="flex flex-col gap-3 border-t pt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h3 id="payment-links-title" className="font-medium">
            {t("title")}
          </h3>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <p className="text-sm">
            <span className="text-muted-foreground">{t("capacity")}: </span>
            <MoneyText amount={capacity} currency={currency} className="font-medium" />
          </p>
        </div>
        {canCreate ? (
          <div className="flex flex-col items-end gap-1">
            <PaymentLinksCreateDialog
              invoiceId={invoiceId}
              currency={currency}
              capacity={capacity}
              disabled={!supported}
            />
            {supported ? null : (
              <p className="max-w-xs text-right text-xs text-muted-foreground">
                {tRoot("validation.paymentLinkCurrencyUnsupported")}
              </p>
            )}
          </div>
        ) : null}
      </div>

      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {links.map((link) => {
            const reason = reasonText(link.deactivationReason);
            return (
              <li key={link.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3 text-sm">
                <MoneyText amount={link.amount} currency={link.currency} className="font-medium" />
                <Badge variant={STATUS_VARIANT[link.status]}>{t(`status.${link.status}`)}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {t("columns.createdAt")}: {formatDateTime(new Date(link.createdAt), locale, "short")}
                </span>
                {reason ? (
                  <span className="text-xs text-muted-foreground">
                    {t("columns.reason")}: {reason}
                  </span>
                ) : null}
                <span className="ms-auto flex items-center gap-2">
                  {link.paymentId ? (
                    <Link className="text-primary underline-offset-4 hover:underline" href={`/payments/${link.paymentId}`}>
                      {t("viewPayment")}
                    </Link>
                  ) : null}
                  {link.status === "ACTIVE" && link.url && isHttpsUrl(link.url) ? (
                    <>
                      <a
                        className="text-primary underline-offset-4 hover:underline"
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {t("open")}
                      </a>
                      <PaymentLinkCopyButton url={link.url} />
                    </>
                  ) : null}
                  {canCreate && isLinkOpen(link.status) ? (
                    <PaymentLinksDeactivate invoiceId={invoiceId} linkId={link.id} />
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
