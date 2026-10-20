import type { DateOnly } from "@/lib/dates";
import type { MoneyString } from "@/lib/money";
import type { InvoiceStatus } from "@/lib/validators/enums";

/** An open invoice offered by the payment form ("Aplicar a facturas"), as the payments service returns it. */
export type OpenInvoiceOption = {
  id: string;
  code: string;
  invoiceNumber: string;
  currency: string;
  usdRate: MoneyString;
  dueDate: DateOnly;
  balance: MoneyString;
  status: InvoiceStatus;
};
