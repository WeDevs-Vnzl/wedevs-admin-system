import { describe, expect, it } from 'vitest';
import {
  INTEGRATION_EVENT_OUTCOME_VALUES,
  INTEGRATION_PROVIDER_VALUES,
  isIntegrationEventOutcome,
} from './integration-event';

describe('integration event vocabulary', () => {
  it('lists the outcomes the event store records', () => {
    expect([...INTEGRATION_EVENT_OUTCOME_VALUES]).toEqual([
      'PROCESSED',
      'IGNORED',
      'PARKED',
      'FAILED',
    ]);
  });

  it('declares BANK now so the deferred adapter adds no enum migration', () => {
    expect([...INTEGRATION_PROVIDER_VALUES]).toEqual(['STRIPE', 'BINANCE', 'BANK']);
  });

  it('narrows outcomes', () => {
    expect(isIntegrationEventOutcome('PARKED')).toBe(true);
    expect(isIntegrationEventOutcome('DUPLICATE')).toBe(false);
  });
});
