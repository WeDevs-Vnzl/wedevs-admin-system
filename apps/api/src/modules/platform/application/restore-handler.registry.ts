import type { RestoreHandler, TrashableEntityType } from './ports/restore-handler.port';

/**
 * Multi-provider registry of `RestoreHandler`s (the `FileAccessRegistry` pattern). Contexts call `register`
 * from their module's `onModuleInit`; a type has at most one handler.
 */
export class RestoreHandlerRegistry {
  private readonly handlers = new Map<TrashableEntityType, RestoreHandler>();

  /** Idempotent for the same handler; a second, different handler for a type is a wiring bug. */
  register(handler: RestoreHandler): void {
    const existing = this.handlers.get(handler.entityType);
    if (existing === handler) return;
    if (existing) {
      throw new Error(`A restore handler is already registered for ${handler.entityType}`);
    }
    this.handlers.set(handler.entityType, handler);
  }

  get(entityType: string): RestoreHandler | undefined {
    return this.handlers.get(entityType as TrashableEntityType);
  }

  /** Every registered handler, in registration order. */
  all(): readonly RestoreHandler[] {
    return [...this.handlers.values()];
  }
}
