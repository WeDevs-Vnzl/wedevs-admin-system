import type { CurrentUser } from '../../../../shared/application/current-user';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import { toTechnologyView, type TechnologyView } from '../../domain/technology';
import type { TechnologyRepository } from '../ports/technology.repository.port';
import type { TechnologyUsagePort } from '../ports/technology-usage.port';

/**
 * `GET /technologies/{id}`. Reference read: every signed-in role may read it (DT-71), so the use case
 * checks nothing beyond the actor it receives. `NOT_FOUND` for an unknown id.
 */
export class GetTechnology {
  constructor(
    private readonly technologies: TechnologyRepository,
    private readonly usage: TechnologyUsagePort,
  ) {}

  async execute(_actor: CurrentUser, input: { readonly id: string }): Promise<TechnologyView> {
    const row = await this.technologies.findById(input.id);
    if (!row) throw new NotFoundError();
    return toTechnologyView(row, await this.usage.countLiveProjects(row.id));
  }
}
