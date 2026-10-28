import type { CurrentUser } from '../../../../shared/application/current-user';
import { NotFoundError } from '../../../../shared/domain/domain-error';
import type { TagRepository } from '../ports/tag.repository.port';
import type { TagOutput } from './list-tags.use-case';

/** `GET /tags/{id}`: one tag with its usage over every entity type (reference catalog, DT-71). */
export class GetTag {
  constructor(private readonly tags: TagRepository) {}

  async execute(_actor: CurrentUser, input: { id: string }): Promise<TagOutput> {
    const tag = await this.tags.findWithUsage(input.id);
    if (!tag) throw new NotFoundError();
    return tag;
  }
}
