import type { ShareAccessLogRetentionPort } from '../../../../src/modules/documents/application/ports/share-access-log-retention.port';

/** Fake retention port over a list of creation instants. Mirrors the adapter: strictly before, oldest first. */
export class InMemoryShareAccessLogRetention implements ShareAccessLogRetentionPort {
  readonly calls: { cutoff: Date; limit: number }[] = [];

  constructor(public rows: Date[] = []) {}

  async deleteCreatedBefore(cutoff: Date, limit: number): Promise<number> {
    this.calls.push({ cutoff, limit });
    const doomed = this.rows
      .filter((createdAt) => createdAt.getTime() < cutoff.getTime())
      .sort((a, b) => a.getTime() - b.getTime())
      .slice(0, limit);
    this.rows = this.rows.filter((row) => !doomed.includes(row));
    return doomed.length;
  }
}
