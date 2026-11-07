import { describe, expectTypeOf, it } from "vitest";
import type { DateOnly } from "@/lib/dates";
import type { MoneyString } from "@/lib/money";
import type { InvoiceStatus } from "@/lib/validators/enums";
import type { OpenInvoiceOption } from "./types";

// W4 frozen exports (DT-218): the consumers read these exact fields. `searchPaymentsAction` is pinned in
// `actions.test.ts` and `ClientPaymentsTab` in `components/client-payments-tab.test.tsx`.
describe("OpenInvoiceOption (frozen, read by the payment form and the mocks)", () => {
  it("keeps its exact fields", () => {
    expectTypeOf<OpenInvoiceOption>().toEqualTypeOf<{
      id: string;
      code: string;
      invoiceNumber: string;
      currency: string;
      usdRate: MoneyString;
      dueDate: DateOnly;
      balance: MoneyString;
      status: InvoiceStatus;
    }>();
  });
});
