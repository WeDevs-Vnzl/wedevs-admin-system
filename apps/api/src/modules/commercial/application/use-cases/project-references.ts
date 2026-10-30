import { NotFoundError, ValidationFailedError } from '../../../../shared/domain/domain-error';
import { PROJECT_KEYS, type ProjectRecord } from '../../domain/project';
import type { ProjectRepository } from '../ports/project.repository.port';
import type {
  ProjectTechnologyCatalogPort,
  ProjectTechnologyEntry,
} from '../ports/project-technology-catalog.port';

const invalid = (field: string, key: string): ValidationFailedError =>
  new ValidationFailedError({ fieldErrors: { [field]: [key] } });

/**
 * Checks of the ids a project points at (C14: a client id is never trusted without a lookup). Clients
 * are read through commercial's own repository, technologies through settings' catalog.
 */
export class ProjectReferences {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly technologies: ProjectTechnologyCatalogPort,
  ) {}

  /** Every client must exist and not be archived; the ones already linked keep their link. */
  async assertClients(
    clientIds: readonly string[],
    alreadyLinked: readonly string[] = [],
  ): Promise<void> {
    const toCheck = clientIds.filter((id) => !alreadyLinked.includes(id));
    if (toCheck.length === 0) return;
    const live = new Set(await this.projects.liveClientIds(toCheck));
    if (toCheck.some((id) => !live.has(id))) {
      throw invalid('clients', PROJECT_KEYS.clientNotFound);
    }
  }

  /**
   * The stack takes catalog ids only (HU-06 CA1): unknown → `VALIDATION` on `technologyIds`, and so is
   * an inactive technology unless the project already carried it (editing never forces the stack to
   * change). Returns the catalog entries of `ids`.
   */
  async assertTechnologies(
    ids: readonly string[],
    alreadyOnProject: readonly string[] = [],
  ): Promise<ProjectTechnologyEntry[]> {
    const entries = await this.technologies.findByIds(ids);
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    for (const id of ids) {
      const entry = byId.get(id);
      if (!entry) throw invalid('technologyIds', PROJECT_KEYS.technologyUnknown);
      if (!entry.active && !alreadyOnProject.includes(id)) {
        throw invalid('technologyIds', PROJECT_KEYS.technologyInactive);
      }
    }
    return entries;
  }

  /** Names of the technologies, for the readable diff snapshot; an unknown id falls back to the id. */
  async technologyNames(ids: readonly string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const byId = new Map((await this.technologies.findByIds(ids)).map((e) => [e.id, e.name]));
    return ids.map((id) => byId.get(id) ?? id);
  }
}

/** A project that can still be edited: unknown and archived rows answer `NOT_FOUND` to mutations. */
export async function loadLiveProject(
  projects: ProjectRepository,
  id: string,
): Promise<ProjectRecord> {
  const record = await projects.findById(id);
  if (!record || record.archivedAt !== null) throw new NotFoundError();
  return record;
}

/** The project as stored after a write, inside the same unit of work. */
export async function reloadProject(
  projects: ProjectRepository,
  id: string,
): Promise<ProjectRecord> {
  const record = await projects.findById(id);
  if (!record) throw new NotFoundError();
  return record;
}
