import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { PaymentForm } from "@/features/payments/components/payment-form";
import { paymentScreenPermissions } from "@/features/payments/permissions";
import { getInvoiceForPayment, listOpenInvoices } from "@/features/payments/queries";
import { listAccounts } from "@/features/accounts/queries";
import { listClients } from "@/features/clients/queries";
import { listPaymentMethods, getFiscalSettings } from "@/features/catalogs/queries";
import { todayInCaracas } from "@/lib/dates";
import { requireSessionUser } from "@/server/auth/session";

type PaymentNewPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payments.page");
  return { title: t("newTitle") };
}

// `/payments/new` (HU-13). Roles without the payment create grant get the not-found page. `?invoiceId=` preselects
// the client and ticks that invoice; an invoice that no longer takes a payment opens the empty form.
export default async function NewPaymentPage({ searchParams }: PaymentNewPageProps) {
  const user = await requireSessionUser();
  const permissions = paymentScreenPermissions(user);
  if (!permissions.canCreate) notFound();
  const { invoiceId } = await searchParams;
  const requestedInvoice =
    typeof invoiceId === "string" ? await getInvoiceForPayment(invoiceId) : null;

  const [clients, accounts, methods, fiscal, openInvoices] = await Promise.all([
    listClients({ pageSize: 100 }),
    listAccounts({ pageSize: 100 }),
    listPaymentMethods({}),
    getFiscalSettings(),
    requestedInvoice ? listOpenInvoices(requestedInvoice.client.id) : Promise.resolve([]),
  ]);

  return (
    <PaymentForm
      clients={clients.items.map((client) => ({ id: client.id, name: client.tradeName }))}
      accounts={accounts.items
        .filter((account) => account.active)
        .map(({ id, name, currency }) => ({ id, name, currency }))}
      methods={methods
        .filter((method) => method.active)
        .map(({ id, code, name, nameEn, requiresReference, suggestsIgtf }) => ({
          id,
          code,
          name,
          nameEn,
          requiresReference,
          suggestsIgtf,
        }))}
      fiscal={{ igtfRate: fiscal.igtfRate, igtfCurrencies: fiscal.igtfCurrencies }}
      today={todayInCaracas(new Date())}
      initialClientId={requestedInvoice?.client.id}
      initialOpenInvoices={openInvoices}
      initialInvoiceId={requestedInvoice?.invoice.id}
    />
  );
}
