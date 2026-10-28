/**
 * Write side of the non-financial columns of `ClientMetrics` (DT-111). Touches only `projectCount` and
 * `lastActivityAt`; the money columns belong to BE-3's `FinanceProjector`. Valid only inside
 * `UnitOfWorkPort.run`.
 */
export interface ClientMetricsWriterPort {
  /** Creates the row with defaults when it does not exist. */
  ensure(clientId: string): Promise<void>;
  /** Sets `projectCount` (creating the row if needed). */
  setProjectCount(clientId: string, count: number): Promise<void>;
  /** Moves `lastActivityAt` forward to `at` for each client; never backwards. */
  touchActivity(clientIds: readonly string[], at: Date): Promise<void>;
}
