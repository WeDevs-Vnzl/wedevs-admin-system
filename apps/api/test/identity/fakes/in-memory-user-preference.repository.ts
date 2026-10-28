import type { UserPreferenceRepository } from '../../../src/modules/identity/application/ports/user-preference.repository.port';
import type { StoredPreference } from '../../../src/modules/identity/domain/preference';

export interface PreferenceRow extends StoredPreference {
  readonly userId: string;
}

export class InMemoryUserPreferenceRepository implements UserPreferenceRepository {
  rows: PreferenceRow[] = [];

  listByUser(userId: string): Promise<StoredPreference[]> {
    return Promise.resolve(
      this.rows
        .filter((row) => row.userId === userId)
        .map(({ key, value }) => ({ key, value: structuredClone(value) })),
    );
  }

  upsert(userId: string, key: string, value: unknown): Promise<void> {
    const copy = structuredClone(value);
    const index = this.rows.findIndex((row) => row.userId === userId && row.key === key);
    if (index >= 0) this.rows[index] = { userId, key, value: copy };
    else this.rows.push({ userId, key, value: copy });
    return Promise.resolve();
  }

  remove(userId: string, key: string): Promise<void> {
    this.rows = this.rows.filter((row) => !(row.userId === userId && row.key === key));
    return Promise.resolve();
  }
}
