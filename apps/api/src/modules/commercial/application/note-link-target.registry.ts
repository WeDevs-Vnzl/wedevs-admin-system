import { NotFoundError, ValidationFailedError } from '../../../shared/domain/domain-error';
import type { EntityRef } from '../../../shared/domain/entity-ref';
import {
  INVALID_OPTION_KEY,
  isOwnNoteLinkType,
  linkKey,
  type NoteLinkEntityType,
  type NoteLinkTarget,
} from '../domain/note-link';
import type { NoteTargetPort, ResolvedNoteTarget } from './ports/note-target.port';

/** What a context says about the records of a type a note may hang from. Keys are record ids. */
export interface NoteLinkTargetResolver {
  readonly entityType: NoteLinkEntityType;
  resolve(ids: readonly string[]): Promise<Map<string, ResolvedNoteTarget>>;
}

/**
 * Where a note's link targets are resolved. Clients, contacts and projects come from the commercial
 * context's own port; the other types (documents, invoices, payments, expenses) are registered by the
 * contexts that own them from their module's `onModuleInit` (BE-3, BE-4). A type nobody registered is
 * not linkable yet: `VALIDATION` (`validation.invalidOption`).
 */
export class NoteLinkTargetRegistry {
  private readonly resolvers = new Map<NoteLinkEntityType, NoteLinkTargetResolver>();

  constructor(private readonly own: NoteTargetPort) {}

  /** Registers (or replaces) the resolver of its type; the commercial types are never overridden. */
  register(resolver: NoteLinkTargetResolver): void {
    if (isOwnNoteLinkType(resolver.entityType)) {
      throw new Error(`${resolver.entityType} note targets are resolved by the commercial context`);
    }
    this.resolvers.set(resolver.entityType, resolver);
  }

  supports(entityType: NoteLinkEntityType): boolean {
    return isOwnNoteLinkType(entityType) || this.resolvers.has(entityType);
  }

  /** Keyed by `linkKey`; targets of an unsupported type or an unknown id are absent. */
  async resolve(targets: readonly NoteLinkTarget[]): Promise<Map<string, ResolvedNoteTarget>> {
    const result = new Map<string, ResolvedNoteTarget>();
    const own = targets.filter((target) => isOwnNoteLinkType(target.entityType));
    if (own.length > 0) {
      for (const [key, value] of await this.own.resolve(own)) result.set(key, value);
    }
    const byType = new Map<NoteLinkEntityType, string[]>();
    for (const target of targets) {
      if (!this.resolvers.has(target.entityType)) continue;
      byType.set(target.entityType, [...(byType.get(target.entityType) ?? []), target.entityId]);
    }
    for (const [entityType, ids] of byType) {
      const found = await (this.resolvers.get(entityType) as NoteLinkTargetResolver).resolve(ids);
      for (const [id, value] of found) result.set(linkKey({ entityType, entityId: id }), value);
    }
    return result;
  }

  /**
   * The references of `targets`, in order, all of them live. An unregistered type is `VALIDATION` on
   * `fieldFor(index)`; a record that is unknown or archived is `NOT_FOUND` (C14, C19).
   */
  async requireLive(
    targets: readonly NoteLinkTarget[],
    fieldFor: (index: number) => string,
  ): Promise<EntityRef[]> {
    targets.forEach((target, index) => {
      if (!this.supports(target.entityType)) {
        throw new ValidationFailedError({
          fieldErrors: { [fieldFor(index)]: [INVALID_OPTION_KEY] },
        });
      }
    });
    const resolved = await this.resolve(targets);
    return targets.map((target) => {
      const found = resolved.get(linkKey(target));
      if (!found || found.archived) throw new NotFoundError();
      return found.ref;
    });
  }
}
