export const INTEGRATION_MAPPING = Symbol('INTEGRATION_MAPPING');

/** Where provider money lands (`/settings/integrations`, DT-183, DT-184); null when not configured. */
export interface IntegrationMapping {
  readonly stripe: { readonly accountId: string; readonly paymentMethodId: string } | null;
  readonly binance: { readonly accountId: string } | null;
}

export interface IntegrationMappingPort {
  load(): Promise<IntegrationMapping>;
}
