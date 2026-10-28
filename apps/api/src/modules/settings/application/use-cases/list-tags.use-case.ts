import type { CurrentUser } from '../../../../shared/application/current-user';
import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { TagWithUsage } from '../../domain/tag';
import type { TagRepository } from '../ports/tag.repository.port';

/** Output model of the tag list rows and the tag detail. */
export type TagOutput = TagWithUsage;

/**
 * `GET /tags`. Tag names and colours are a reference catalog every signed-in user reads (DT-71), so the
 * route is `@Authenticated()` and the use case runs no `can()`. `query.filters.entityType` keeps the tags
 * assigned to at least one live record of those types.
 */
export class ListTags {
  constructor(private readonly tags: TagRepository) {}

  execute(_actor: CurrentUser, query: ListQuery): Promise<Paginated<TagOutput>> {
    return this.tags.list(query);
  }
}
