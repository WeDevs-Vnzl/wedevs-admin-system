import type { Tag, TagTarget } from '../../domain/tag';

export const TAG_ASSIGNMENT_REPOSITORY = Symbol('TAG_ASSIGNMENT_REPOSITORY');

/** `TagAssignment` rows: one tag on one target. Writes need the caller's unit of work. */
export interface TagAssignmentRepository {
  /** Ids of the tags on one target. */
  tagIdsFor(target: TagTarget): Promise<string[]>;
  /** The tags on each target, in chip order, keyed by `targetKey`; every requested target has a key. */
  tagsFor(targets: readonly TagTarget[]): Promise<Map<string, Tag[]>>;
  /** Adds the pairs that are not there yet. */
  add(target: TagTarget, tagIds: readonly string[]): Promise<void>;
  remove(target: TagTarget, tagIds: readonly string[]): Promise<void>;
}
