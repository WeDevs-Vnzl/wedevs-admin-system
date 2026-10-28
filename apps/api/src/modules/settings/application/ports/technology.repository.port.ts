import type { TechnologyRecord } from '../../domain/technology';

/**
 * `Technology` rows (PRD §10.2, Δ4 `nameEn`). Reads and writes run in the caller's unit of work when one
 * is open. The catalog is small and bounded, so the list reads every row and the domain filters and
 * sorts it. Writes translate database unique violations to `ConflictError` with the field, and a
 * foreign-key violation on delete to `IntegrityLockedError`.
 */
export interface TechnologyRepository {
  /** Every technology, unfiltered. */
  findAll(): Promise<TechnologyRecord[]>;
  /** `null` when the id is unknown. */
  findById(id: string): Promise<TechnologyRecord | null>;
  /** The technologies whose id is listed; unknown ids are absent from the result. */
  findByIds(ids: readonly string[]): Promise<TechnologyRecord[]>;
  insert(record: TechnologyRecord): Promise<void>;
  /** Replaces every stored value of the row `record.id`. */
  update(record: TechnologyRecord): Promise<void>;
  /** Hard delete (the catalog is never soft-deleted, C19). */
  delete(id: string): Promise<void>;
}

export const TECHNOLOGY_REPOSITORY = Symbol('TECHNOLOGY_REPOSITORY');
