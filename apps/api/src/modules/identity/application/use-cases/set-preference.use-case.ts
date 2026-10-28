import type { CurrentUser } from '../../../../shared/application/current-user';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import { parsePreferenceInput, type UserPreferences } from '../../domain/preference';
import type { UserPreferenceRepository } from '../ports/user-preference.repository.port';
import type { UserRepository } from '../ports/user.repository.port';
import { loadPreferences } from './get-preferences.use-case';

export interface SetPreferenceInput {
  readonly key: string;
  readonly value: unknown;
}

/** `PUT /me/preferences/{key}`: stores one preference of the caller (replacing it) and returns them all. */
export class SetPreference {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: UserPreferenceRepository,
  ) {}

  async execute(actor: CurrentUser, input: SetPreferenceInput): Promise<UserPreferences> {
    const parsed = parsePreferenceInput(input.key, input.value);
    if (!parsed.ok) throw new ValidationFailedError({ fieldErrors: parsed.fieldErrors });
    // No unit of work: a single write and no activity entry (preferences are not audited).
    await this.preferences.upsert(actor.userId, parsed.entry.key, parsed.entry.value);
    return loadPreferences(this.users, this.preferences, actor.userId);
  }
}
