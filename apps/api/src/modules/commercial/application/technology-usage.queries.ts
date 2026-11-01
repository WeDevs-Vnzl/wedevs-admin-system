import type { ProjectRepository } from './ports/project.repository.port';

/**
 * Exported queries of how projects use a technology (HU-06 CA3). Settings declares its own
 * `TechnologyUsagePort` and does not read the project tables; package 4.1 binds that port to this class.
 * Commercial's project repository answers both reads, so the project tables stay behind it.
 */
export class TechnologyUsageQueries {
  constructor(private readonly projects: ProjectRepository) {}

  /** Non-archived projects that list the technology in their stack. */
  countLiveProjects(technologyId: string): Promise<number> {
    return this.projects.countLiveByTechnology(technologyId);
  }

  /**
   * Removes the technology from the stacks of archived projects, so no stack points at a missing row.
   * Joins the caller's unit of work (the technology delete's).
   */
  detachFromArchivedProjects(technologyId: string): Promise<void> {
    return this.projects.detachTechnologyFromArchived(technologyId);
  }
}
