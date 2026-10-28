import type { ListQuery } from '../../../../shared/domain/list-query';
import type { Paginated } from '../../../../shared/domain/pagination';
import type { Tag, TagWithUsage } from '../../domain/tag';

export const TAG_REPOSITORY = Symbol('TAG_REPOSITORY');

/**
 * The tag catalog. Writes run inside the caller's unit of work. Usage counts follow the mock's
 * `tagUsage`: assignments whose target is not archived.
 */
export interface TagRepository {
  /**
   * One page of tags with usage. `query.filters.entityType` (one value or several) limits the usage to
   * those entity types and hides tags with no usage there. Sorts: `name`, `usageCount`, `createdAt`.
   */
  list(query: ListQuery): Promise<Paginated<TagWithUsage>>;
  /** One tag with its usage over every entity type. */
  findWithUsage(id: string): Promise<TagWithUsage | null>;
  find(id: string): Promise<Tag | null>;
  /** Case- and space-insensitive lookup of the name. */
  findByName(name: string): Promise<Tag | null>;
  /** The tags that exist among `ids` (unknown ids are absent from the result). */
  findManyByIds(ids: readonly string[]): Promise<Tag[]>;
  insert(tag: Tag): Promise<void>;
  /** Rewrites `name` and `color`. */
  update(tag: Tag): Promise<void>;
}
