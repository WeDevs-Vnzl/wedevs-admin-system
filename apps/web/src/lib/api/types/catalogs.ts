import type { components, operations } from "../schema";

// Generated response and request DTOs of the catalog endpoints, re-exported for code outside `src/lib/api/**`
// (which may not import `../schema`, ESLint). Re-exports only (C8): never a hand-written copy of a DTO.

type Schemas = components["schemas"];

export type CurrencyResponseDto = Schemas["CurrencyResponseDto"];
export type CreateCurrencyDto = Schemas["CreateCurrencyDto"];
export type UpdateCurrencyDto = Schemas["UpdateCurrencyDto"];

export type PaymentMethodResponseDto = Schemas["PaymentMethodResponseDto"];
export type CreatePaymentMethodDto = Schemas["CreatePaymentMethodDto"];
export type UpdatePaymentMethodDto = Schemas["UpdatePaymentMethodDto"];

export type ExpenseCategoryNodeDto = Schemas["ExpenseCategoryNodeDto"];
export type ExpenseCategoryResponseDto = Schemas["ExpenseCategoryResponseDto"];
export type CreateExpenseCategoryDto = Schemas["CreateExpenseCategoryDto"];
export type UpdateExpenseCategoryDto = Schemas["UpdateExpenseCategoryDto"];

export type FiscalSettingsResponseDto = Schemas["FiscalSettingsResponseDto"];
export type UpdateFiscalSettingsDto = Schemas["UpdateFiscalSettingsDto"];

export type ExchangeRateListResponseDto = Schemas["ExchangeRateListResponseDto"];
export type UpsertExchangeRateDto = Schemas["UpsertExchangeRateDto"];
export type UpsertExchangeRateResponseDto = Schemas["UpsertExchangeRateResponseDto"];
export type LoadDailyRatesDto = Schemas["LoadDailyRatesDto"];
export type LoadDailyRatesResponseDto = Schemas["LoadDailyRatesResponseDto"];
export type ImportRatesDto = Schemas["ImportRatesDto"];
export type ImportRatesResponseDto = Schemas["ImportRatesResponseDto"];
export type RateLookupResponseDto = Schemas["RateLookupResponseDto"];

export type TagListResponseDto = Schemas["TagListResponseDto"];
export type TechnologyListResponseDto = Schemas["TechnologyListResponseDto"];
export type DocumentCategoryResponseDto = Schemas["DocumentCategoryResponseDto"];
export type DocumentTypeListResponseDto = Schemas["DocumentTypeListResponseDto"];

// Query parameters of the list endpoints (sort whitelists and facet shapes as the BE declares them).
type QueryOf<Operation extends keyof operations> = NonNullable<
  operations[Operation]["parameters"]["query"]
>;

export type TagListQuery = QueryOf<"listTags">;
export type TechnologyListQuery = QueryOf<"listTechnologies">;
export type DocumentTypeListQuery = QueryOf<"listDocumentTypes">;
export type ExchangeRateListQuery = QueryOf<"listExchangeRates">;
