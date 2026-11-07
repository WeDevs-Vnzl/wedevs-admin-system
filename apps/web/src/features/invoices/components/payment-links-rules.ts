import { isZeroMoney } from "@/lib/money";
import type { PaymentLinkStatus } from "@/lib/api/types/payment-links";

// Cosmetic gates for the payment-links panel (6.1): the BE re-checks every one of them (DT-197, DT-200).

/** Invoice currencies the Stripe links support (DT-197); the BE refuses anything else. */
const SUPPORTED_CURRENCIES = ["USD", "EUR"] as const;

/** A link can be created for a supported currency while there is capacity left (`"0.00"` means none, DT-200). */
export function supportsPaymentLinks(currency: string, capacity: string): boolean {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(currency) && !isZeroMoney(capacity);
}

/** `PENDING` and `ACTIVE` links can still be deactivated. */
export function isLinkOpen(status: PaymentLinkStatus): boolean {
  return status === "PENDING" || status === "ACTIVE";
}

/** Only an `https:` URL is opened or copied; anything else (http, javascript:, garbage) is not offered. */
export function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}
