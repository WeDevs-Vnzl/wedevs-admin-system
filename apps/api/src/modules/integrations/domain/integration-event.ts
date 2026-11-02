/** Providers of integration events (mirrors the `IntegrationProvider` enum; BANK is declared for the deferred adapter). */
export const INTEGRATION_PROVIDER_VALUES = ['STRIPE', 'BINANCE', 'BANK'] as const;
export type IntegrationProvider = (typeof INTEGRATION_PROVIDER_VALUES)[number];

/** What became of a provider event (A2). A duplicate delivery is not an outcome: nothing is written. */
export const INTEGRATION_EVENT_OUTCOME_VALUES = [
  'PROCESSED',
  'IGNORED',
  'PARKED',
  'FAILED',
] as const;
export type IntegrationEventOutcome = (typeof INTEGRATION_EVENT_OUTCOME_VALUES)[number];

export function isIntegrationEventOutcome(value: string): value is IntegrationEventOutcome {
  return (INTEGRATION_EVENT_OUTCOME_VALUES as readonly string[]).includes(value);
}
