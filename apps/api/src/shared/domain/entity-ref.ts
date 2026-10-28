import type { EntityType } from './enums';

/** Lightweight pointer to an entity, used across contexts instead of importing their models. */
export interface EntityRef {
  readonly type: EntityType;
  readonly id: string;
  readonly code?: string;
  readonly label: string;
}
