import type { TagAssignmentRepository } from '../../../src/modules/settings/application/ports/tag-assignment.repository.port';
import type { TagRepository } from '../../../src/modules/settings/application/ports/tag.repository.port';
import type {
  TaggableTarget,
  TaggableTargetResolver,
} from '../../../src/modules/settings/application/ports/taggable-target.port';
import {
  compareTagsForChips,
  sameTagName,
  targetKey,
  type Tag,
  type TagTarget,
  type TagWithUsage,
  type TaggableEntityType,
} from '../../../src/modules/settings/domain/tag';
import type { PermissionResource } from '../../../src/shared/application/authorization';
import { foldText, type ListQuery } from '../../../src/shared/domain/list-query';
import { paginated, type Paginated } from '../../../src/shared/domain/pagination';
import type {
  InMemoryUnitOfWork,
  TransactionParticipant,
} from '../../support/fakes/in-memory-unit-of-work';

/** `TagAssignment` rows in memory. Writes become visible on commit and vanish on rollback. */
export class InMemoryTagAssignmentRepository
  implements TagAssignmentRepository, TransactionParticipant
{
  private committed = new Map<string, Set<string>>();
  private pending = new Map<string, Set<string>>();
  /** Set by `InMemoryTagRepository` so `tagsFor` can read the catalog. */
  tags: InMemoryTagRepository | null = null;

  constructor(private readonly uow: InMemoryUnitOfWork) {
    uow.enlist(this);
  }

  private get source(): Map<string, Set<string>> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  /** Committed ids on a target, for assertions. */
  committedIds(target: TagTarget): string[] {
    return [...(this.committed.get(targetKey(target)) ?? [])];
  }

  /** Every committed `targetKey -> tagIds` pair; used for usage counts. */
  entries(): [string, string[]][] {
    return [...this.source.entries()].map(([key, ids]) => [key, [...ids]]);
  }

  async tagIdsFor(target: TagTarget): Promise<string[]> {
    return [...(this.source.get(targetKey(target)) ?? [])];
  }

  async tagsFor(targets: readonly TagTarget[]): Promise<Map<string, Tag[]>> {
    const result = new Map<string, Tag[]>();
    for (const target of targets) {
      const ids = [...(this.source.get(targetKey(target)) ?? [])];
      const found = this.tags ? await this.tags.findManyByIds(ids) : [];
      result.set(targetKey(target), found.sort(compareTagsForChips));
    }
    return result;
  }

  async add(target: TagTarget, tagIds: readonly string[]): Promise<void> {
    this.uow.assertActive('TagAssignmentRepository.add');
    const key = targetKey(target);
    const set = this.pending.get(key) ?? new Set<string>();
    for (const id of tagIds) set.add(id);
    this.pending.set(key, set);
  }

  async remove(target: TagTarget, tagIds: readonly string[]): Promise<void> {
    this.uow.assertActive('TagAssignmentRepository.remove');
    const set = this.pending.get(targetKey(target));
    for (const id of tagIds) set?.delete(id);
  }

  begin(): void {
    this.pending = cloneMap(this.committed);
  }
  commit(): void {
    this.committed = this.pending;
  }
  rollback(): void {
    this.pending = cloneMap(this.committed);
  }
}

function cloneMap(map: Map<string, Set<string>>): Map<string, Set<string>> {
  return new Map([...map.entries()].map(([key, ids]) => [key, new Set(ids)]));
}

export interface InMemoryTagRepositoryOptions {
  /** Whether a target counts for usage (false = archived). Defaults to all live. */
  readonly isLive?: (targetKey: string) => boolean;
}

/** The tag catalog in memory, with the usage semantics of the mock's `tagUsage`. */
export class InMemoryTagRepository implements TagRepository, TransactionParticipant {
  private committed = new Map<string, Tag>();
  private pending = new Map<string, Tag>();
  isLive: (targetKey: string) => boolean;

  constructor(
    private readonly uow: InMemoryUnitOfWork,
    private readonly assignments: InMemoryTagAssignmentRepository,
    options: InMemoryTagRepositoryOptions = {},
  ) {
    uow.enlist(this);
    assignments.tags = this;
    this.isLive = options.isLive ?? (() => true);
  }

  private get source(): Map<string, Tag> {
    return this.uow.isActive ? this.pending : this.committed;
  }

  get rows(): Tag[] {
    return [...this.committed.values()];
  }

  seed(tag: Tag): void {
    this.committed.set(tag.id, tag);
  }

  private usage(tagId: string, entityTypes?: readonly string[]): number {
    let count = 0;
    for (const [key, ids] of this.assignments.entries()) {
      if (!ids.includes(tagId) || !this.isLive(key)) continue;
      if (entityTypes && !entityTypes.includes(key.split(':')[0] as TaggableEntityType)) continue;
      count += 1;
    }
    return count;
  }

  async list(query: ListQuery): Promise<Paginated<TagWithUsage>> {
    const raw = query.filters.entityType;
    const types = raw === undefined ? undefined : Array.isArray(raw) ? [...raw] : [raw as string];
    let rows = [...this.source.values()].map((tag) => ({
      ...tag,
      usageCount: this.usage(tag.id, types),
    }));
    if (types) rows = rows.filter((row) => row.usageCount > 0);
    if (query.q) rows = rows.filter((row) => foldText(row.name).includes(foldText(query.q ?? '')));
    const sort = query.sort ?? { field: 'name', direction: 'asc' as const };
    const direction = sort.direction === 'asc' ? 1 : -1;
    const key = (row: TagWithUsage): string | number =>
      sort.field === 'usageCount'
        ? row.usageCount
        : sort.field === 'createdAt'
          ? row.createdAt.getTime()
          : row.name.toLocaleLowerCase();
    rows.sort((a, b) => {
      const ka = key(a);
      const kb = key(b);
      if (ka < kb) return -direction;
      if (ka > kb) return direction;
      return a.id < b.id ? -1 : 1;
    });
    const start = (query.page - 1) * query.pageSize;
    return paginated(rows.slice(start, start + query.pageSize), rows.length, query);
  }

  async findWithUsage(id: string): Promise<TagWithUsage | null> {
    const tag = this.source.get(id);
    return tag ? { ...tag, usageCount: this.usage(id) } : null;
  }

  async find(id: string): Promise<Tag | null> {
    return this.source.get(id) ?? null;
  }

  async findByName(name: string): Promise<Tag | null> {
    return [...this.source.values()].find((tag) => sameTagName(tag.name, name)) ?? null;
  }

  async findManyByIds(ids: readonly string[]): Promise<Tag[]> {
    return ids.flatMap((id) => {
      const tag = this.source.get(id);
      return tag ? [tag] : [];
    });
  }

  async insert(tag: Tag): Promise<void> {
    this.uow.assertActive('TagRepository.insert');
    this.pending.set(tag.id, tag);
  }

  async update(tag: Tag): Promise<void> {
    this.uow.assertActive('TagRepository.update');
    this.pending.set(tag.id, tag);
  }

  begin(): void {
    this.pending = new Map(this.committed);
  }
  commit(): void {
    this.committed = this.pending;
  }
  rollback(): void {
    this.pending = new Map(this.committed);
  }
}

/** Resolver stand-in for one entity type: records are added with `add` and archived with `archive`. */
export class FakeTaggableTargetResolver implements TaggableTargetResolver {
  private readonly records = new Map<string, TaggableTarget & { archived: boolean }>();

  constructor(
    readonly entityType: TaggableEntityType,
    readonly resource: PermissionResource,
  ) {}

  add(id: string, label: string, clientId: string | null = null): this {
    this.records.set(id, { label, clientId, archived: false });
    return this;
  }

  archive(id: string): void {
    const record = this.records.get(id);
    if (record) record.archived = true;
  }

  async resolve(id: string): Promise<TaggableTarget | null> {
    const record = this.records.get(id);
    return record && !record.archived ? { label: record.label, clientId: record.clientId } : null;
  }
}
