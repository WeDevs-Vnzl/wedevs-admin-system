/** A stored `Setting` row: the key and its JSON value (PRD §10.2). */
export type SettingRecord = {
  readonly key: string;
  readonly value: unknown;
};

/**
 * Key/value access to the `Setting` table. Reads and writes run in the caller's unit of work when one is
 * open. Values are JSON; the mapping to a domain model happens in the use case.
 */
export interface SettingRepository {
  /** `null` when no row has the key. */
  find(key: string): Promise<SettingRecord | null>;
  /** Inserts or replaces the row of `key`. */
  save(key: string, value: unknown): Promise<void>;
}

export const SETTING_REPOSITORY = Symbol('SETTING_REPOSITORY');
