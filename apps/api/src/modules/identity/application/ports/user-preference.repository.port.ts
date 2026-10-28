import type { StoredPreference } from '../../domain/preference';

export const USER_PREFERENCE_REPOSITORY = Symbol('USER_PREFERENCE_REPOSITORY');

/** Own rows only: every method is scoped by `userId`. Reset is a hard delete the PRD allows. */
export interface UserPreferenceRepository {
  listByUser(userId: string): Promise<StoredPreference[]>;
  upsert(userId: string, key: string, value: unknown): Promise<void>;
  remove(userId: string, key: string): Promise<void>;
}
