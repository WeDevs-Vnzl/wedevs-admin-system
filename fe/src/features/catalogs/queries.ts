import "server-only";
import {
  currencyListInputSchema,
  expenseCategoryListInputSchema,
  getRateForInputSchema,
  paymentMethodListInputSchema,
  type CurrencyListInputRaw,
  type ExpenseCategoryListInputRaw,
  type GetRateForInput,
  type PaymentMethodListInputRaw,
} from "@/lib/validators/catalogs";
import {
  documentTypeFilterSchema,
  type DocumentTypeFilterInput,
} from "@/lib/validators/document-types";
import { tagFilterSchema, type TagFilterInput } from "@/lib/validators/tags";
import { technologyFilterSchema, type TechnologyFilterInput } from "@/lib/validators/technologies";
import * as catalogs from "@/mocks/services/catalogs";
import { getServiceContext } from "@/server/context";

// Reference data every signed-in role needs to fill a form (currencies, methods, technologies, tags…).
// Managing it is a different matter: that goes through the `settings` actions (Owner and Admin).

export async function getRateFor(input: GetRateForInput) {
  return catalogs.getRateFor(await getServiceContext(), getRateForInputSchema.parse(input));
}

// Pickers get the active rows only; the Settings screens pass `{ includeInactive: true }` (m-g).

export async function listCurrencies(input: CurrencyListInputRaw = {}) {
  return catalogs.listCurrencies(await getServiceContext(), currencyListInputSchema.parse(input));
}

export async function listPaymentMethods(input: PaymentMethodListInputRaw = {}) {
  return catalogs.listPaymentMethods(
    await getServiceContext(),
    paymentMethodListInputSchema.parse(input),
  );
}

export async function listTechnologies(filter: TechnologyFilterInput = {}) {
  return catalogs.listTechnologies(await getServiceContext(), technologyFilterSchema.parse(filter));
}

export async function listDocumentCategories() {
  return catalogs.listDocumentCategories(await getServiceContext());
}

export async function listDocumentTypes(filter: DocumentTypeFilterInput = {}) {
  return catalogs.listDocumentTypes(
    await getServiceContext(),
    documentTypeFilterSchema.parse(filter),
  );
}

export async function listExpenseCategories(input: ExpenseCategoryListInputRaw = {}) {
  return catalogs.listExpenseCategories(
    await getServiceContext(),
    expenseCategoryListInputSchema.parse(input),
  );
}

export async function listTags(filter: TagFilterInput = {}) {
  return catalogs.listTags(await getServiceContext(), tagFilterSchema.parse(filter));
}

/** Fiscal parameters, incl. `ivaRates`: the source of the allowed VAT rates in invoice forms (C17). */
export async function getFiscalSettings() {
  return catalogs.getFiscalSettings(await getServiceContext());
}
