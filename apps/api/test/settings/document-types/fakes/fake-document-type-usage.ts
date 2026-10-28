import type { DocumentTypeUsagePort } from '../../../../src/modules/settings/application/ports/document-type-usage.port';

/**
 * Fake `DocumentTypeUsagePort`. Counts default to 0 (no documents); `setCount` puts documents behind a
 * type, the way BE-4 will once the `documents` context is bound.
 */
export class FakeDocumentTypeUsage implements DocumentTypeUsagePort {
  private readonly counts = new Map<string, number>();

  setCount(typeId: string, count: number): void {
    this.counts.set(typeId, count);
  }

  /** Back to "no documents anywhere", between tests that share one app. */
  reset(): void {
    this.counts.clear();
  }

  async countDocuments(typeId: string): Promise<number> {
    return this.counts.get(typeId) ?? 0;
  }
}
