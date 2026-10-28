/**
 * Settings' own view of how projects use a technology (HU-06 CA3, Q-BE2-1 style neutral port). Settings
 * does not read the project tables: package 4.1 binds this port to commercial's exported queries
 * (`technology-usage.queries.ts`). Until then the module binds a fail-closed placeholder.
 */
export interface TechnologyUsagePort {
  /** Non-archived projects that list the technology in their stack. */
  countLiveProjects(technologyId: string): Promise<number>;
  /**
   * Removes the technology from the stacks of archived projects, so no stack points at a missing row.
   * Must run inside the caller's unit of work.
   */
  detachFromArchivedProjects(technologyId: string): Promise<void>;
}

export const TECHNOLOGY_USAGE = Symbol('TECHNOLOGY_USAGE');
