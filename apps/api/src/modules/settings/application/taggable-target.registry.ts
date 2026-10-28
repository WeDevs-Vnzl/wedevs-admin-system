import { ValidationFailedError } from '../../../shared/domain/domain-error';
import { INVALID_OPTION_KEY, type TaggableEntityType } from '../domain/tag';
import type { TaggableTargetResolver } from './ports/taggable-target.port';

/**
 * Multi-provider registry of `TaggableTargetResolver`s (the `FileAccessRegistry` pattern). INVOICE,
 * PAYMENT, EXPENSE and DOCUMENT register in BE-3/BE-4; until then they are not taggable.
 */
export class TaggableTargetRegistry {
  private readonly resolvers = new Map<TaggableEntityType, TaggableTargetResolver>();

  /** Registers (or replaces) the resolver of its entity type. */
  register(resolver: TaggableTargetResolver): void {
    this.resolvers.set(resolver.entityType, resolver);
  }

  has(entityType: string): boolean {
    return this.resolvers.has(entityType as TaggableEntityType);
  }

  /** The resolver of `entityType`; `VALIDATION` on `entityType` when none is registered. */
  resolverFor(entityType: string): TaggableTargetResolver {
    const resolver = this.resolvers.get(entityType as TaggableEntityType);
    if (!resolver) {
      throw new ValidationFailedError({ fieldErrors: { entityType: [INVALID_OPTION_KEY] } });
    }
    return resolver;
  }
}
