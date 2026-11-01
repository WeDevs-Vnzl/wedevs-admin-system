import type { TechnologyUsageQueries } from '../../commercial/application/technology-usage.queries';
import type { TechnologyUsagePort } from '../application/ports/technology-usage.port';

/**
 * Binds settings' `TechnologyUsagePort` to commercial's exported `TechnologyUsageQueries` (HU-06 CA3;
 * infrastructure reading another context's application API, rule e). The queries are resolved on first
 * use: commercial's projects module imports settings' technologies module for the catalog, so
 * resolving them at construction would close a provider cycle.
 */
export class CommercialTechnologyUsageAdapter implements TechnologyUsagePort {
  constructor(private readonly resolveQueries: () => TechnologyUsageQueries) {}

  countLiveProjects(technologyId: string): Promise<number> {
    return this.resolveQueries().countLiveProjects(technologyId);
  }

  detachFromArchivedProjects(technologyId: string): Promise<void> {
    return this.resolveQueries().detachFromArchivedProjects(technologyId);
  }
}
