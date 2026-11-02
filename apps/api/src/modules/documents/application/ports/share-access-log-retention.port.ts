export const SHARE_ACCESS_LOG_RETENTION = Symbol('SHARE_ACCESS_LOG_RETENTION');

/**
 * Hard delete of expired `ShareAccessLog` rows (DT-74, A9), apart from the append-only `ShareAccessLogPort`
 * so that only the retention step can reach it. Valid only inside a unit of work.
 */
export interface ShareAccessLogRetentionPort {
  /**
   * Deletes up to `limit` rows whose `createdAt` is strictly before `cutoff`, oldest first, and returns how
   * many. A row at exactly `cutoff`, or any later one, is never touched.
   */
  deleteCreatedBefore(cutoff: Date, limit: number): Promise<number>;
}
