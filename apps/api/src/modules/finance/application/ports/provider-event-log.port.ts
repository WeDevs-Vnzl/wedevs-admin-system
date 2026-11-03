/** The payment providers finance knows by name (Δ18). */
export type ProviderName = 'STRIPE' | 'BINANCE' | 'BANK';

export const PROVIDER_EVENT_LOG = Symbol('PROVIDER_EVENT_LOG');

/** What finance stores about a provider event it handled (A2): no payload. */
export interface ProviderEventLogEntry {
  readonly provider: ProviderName;
  readonly eventId: string;
  readonly type: string;
  readonly outcome: 'PROCESSED' | 'PARKED';
  readonly reasonCode: string | null;
  readonly entityType: 'PAYMENT' | null;
  readonly entityId: string | null;
  readonly receivedAt: Date;
  readonly processedAt: Date | null;
}

/**
 * Finance's idempotency log of provider events, unique on `(provider, eventId)` (DT-110, DT-192): finance
 * declares it, `integrations` implements it over its event table. It runs inside the caller's unit of work, as
 * the first write of the event's effect.
 */
export interface ProviderEventLogPort {
  /** `DUPLICATE` when `(provider, eventId)` is already stored: nothing is written. */
  record(entry: ProviderEventLogEntry): Promise<'RECORDED' | 'DUPLICATE'>;
}
