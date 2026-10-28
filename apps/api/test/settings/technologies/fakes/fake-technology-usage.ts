import type { TechnologyUsagePort } from '../../../../src/modules/settings/application/ports/technology-usage.port';
import type { InMemoryUnitOfWork } from '../../../support/fakes/in-memory-unit-of-work';

/**
 * Fake `TechnologyUsagePort`: live-project counts set by the test. When built with a unit of work, the
 * detach must run inside it (as the commercial adapter does), and every detach is recorded.
 */
export class FakeTechnologyUsage implements TechnologyUsagePort {
  private readonly live = new Map<string, number>();
  readonly detached: string[] = [];

  constructor(private readonly uow?: InMemoryUnitOfWork) {}

  setLiveProjects(technologyId: string, count: number): void {
    this.live.set(technologyId, count);
  }

  /** Forgets every count and every detach, for a shared app across tests. */
  reset(): void {
    this.live.clear();
    this.detached.length = 0;
  }

  async countLiveProjects(technologyId: string): Promise<number> {
    return this.live.get(technologyId) ?? 0;
  }

  async detachFromArchivedProjects(technologyId: string): Promise<void> {
    this.uow?.assertActive('TechnologyUsagePort.detachFromArchivedProjects');
    this.detached.push(technologyId);
  }
}
