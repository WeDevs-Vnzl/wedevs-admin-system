import type { OpenInvoiceResponseDto } from "@/lib/api/types/payments";
import { dateOnlySchema } from "@/lib/validators/common";
import type { OpenInvoiceOption } from "./types";

/** The BE's open invoice as the payment form picks from it (`dueDate` parsed as a date-only value). */
export function toOpenInvoiceOption(dto: OpenInvoiceResponseDto): OpenInvoiceOption {
  return {
    id: dto.id,
    code: dto.code,
    invoiceNumber: dto.invoiceNumber,
    currency: dto.currency,
    usdRate: dto.usdRate,
    dueDate: dateOnlySchema.parse(dto.dueDate),
    balance: dto.balance,
    status: dto.status,
  };
}
