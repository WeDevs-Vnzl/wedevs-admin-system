import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../settings/application/ports/taggable-target.port';
import type { ProjectRepository } from '../application/ports/project.repository.port';
import { earliestClientId } from '../domain/project';

/**
 * Tells settings' tag assignment which projects can carry tags: live ones, labelled by name and scoped
 * to the earliest linked client (Q-BE2-2). Tagging a project is an `update` on `project`.
 */
export class ProjectTaggableResolver implements TaggableTargetResolver {
  readonly entityType = 'PROJECT' as const;
  readonly resource = 'project' as const;

  constructor(private readonly projects: ProjectRepository) {}

  async resolve(id: string): Promise<TaggableTarget | null> {
    const project = await this.projects.findById(id);
    if (!project || project.archivedAt !== null) return null;
    return { label: project.name, clientId: earliestClientId(project.clients) };
  }
}
