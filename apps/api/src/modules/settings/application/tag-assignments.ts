import type { CurrentUser } from '../../../shared/application/current-user';
import { ValidationFailedError } from '../../../shared/domain/domain-error';
import {
  INVALID_OPTION_KEY,
  compareTagsForChips,
  targetKey,
  toTagChip,
  type Tag,
  type TagChip,
  type TagTarget,
} from '../domain/tag';
import type { TagAssignmentRepository } from './ports/tag-assignment.repository.port';
import type { TagRepository } from './ports/tag.repository.port';

/** Tag ids on a target before and after a `replace`, for the caller's diff. */
export interface TagReplacement {
  readonly before: string[];
  readonly after: string[];
}

/**
 * Exported application API of the tag assignments (the seam `commercial` and, later, `finance` and
 * `documents` call). Every write runs inside the **caller's** unit of work: the repositories refuse to
 * write outside one (a programming error, not a `DomainError`). The caller authorizes the target and
 * records its own activity from the returned ids; this class neither checks `can()` nor logs.
 */
export class TagAssignments {
  constructor(
    private readonly tags: TagRepository,
    private readonly assignments: TagAssignmentRepository,
  ) {}

  /**
   * Makes `tagIds` the exact tag set of `target`. An unknown tag id is `VALIDATION`
   * (`fieldErrors.tagIds = ["validation.invalidOption"]`). Returns the ids before and after.
   */
  async replace(
    _actor: CurrentUser,
    target: TagTarget,
    tagIds: readonly string[],
  ): Promise<TagReplacement> {
    const wanted = [...new Set(tagIds)];
    const known = await this.requireKnown(wanted);
    const before = await this.assignments.tagIdsFor(target);
    const toAdd = wanted.filter((id) => !before.includes(id));
    const toRemove = before.filter((id) => !wanted.includes(id));
    await this.assignments.remove(target, toRemove);
    await this.assignments.add(target, toAdd);
    const after = known.map((tag) => tag.id);
    return { before, after };
  }

  /**
   * Adds `tagIds` to `target`, ignoring the ones already there. Returns the tags actually added (input
   * order) and every tag on the target afterwards, in chip order.
   */
  async add(target: TagTarget, tagIds: readonly string[]): Promise<{ added: Tag[]; all: Tag[] }> {
    const wanted = [...new Set(tagIds)];
    const known = await this.requireKnown(wanted);
    const before = await this.assignments.tagIdsFor(target);
    const added = known.filter((tag) => !before.includes(tag.id));
    await this.assignments.add(
      target,
      added.map((tag) => tag.id),
    );
    return { added, all: await this.tagsOn(target) };
  }

  /** Removes one tag; `removed` is the tag when it was assigned, `null` otherwise. */
  async remove(target: TagTarget, tagId: string): Promise<{ removed: Tag | null; all: Tag[] }> {
    const current = await this.tagsOn(target);
    const removed = current.find((tag) => tag.id === tagId) ?? null;
    if (removed) await this.assignments.remove(target, [tagId]);
    return { removed, all: current.filter((tag) => tag.id !== tagId) };
  }

  /** The chips of each target (empty list when it has none), keyed by `targetKey`. */
  async chipsFor(targets: readonly TagTarget[]): Promise<Map<string, TagChip[]>> {
    const byTarget = await this.assignments.tagsFor(targets);
    const result = new Map<string, TagChip[]>();
    for (const target of targets) {
      const key = targetKey(target);
      result.set(key, (byTarget.get(key) ?? []).map(toTagChip));
    }
    return result;
  }

  private async tagsOn(target: TagTarget): Promise<Tag[]> {
    const ids = await this.assignments.tagIdsFor(target);
    return (await this.tags.findManyByIds(ids)).sort(compareTagsForChips);
  }

  /** The tags for `ids` (same order); `VALIDATION` on `tagIds` when one does not exist. */
  private async requireKnown(ids: readonly string[]): Promise<Tag[]> {
    const found = await this.tags.findManyByIds(ids);
    const byId = new Map(found.map((tag) => [tag.id, tag]));
    const ordered: Tag[] = [];
    for (const id of ids) {
      const tag = byId.get(id);
      if (!tag) {
        throw new ValidationFailedError({ fieldErrors: { tagIds: [INVALID_OPTION_KEY] } });
      }
      ordered.push(tag);
    }
    return ordered;
  }
}
