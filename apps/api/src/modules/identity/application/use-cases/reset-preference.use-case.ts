import type { CurrentUser } from '../../../../shared/application/current-user';
import { ValidationFailedError } from '../../../../shared/domain/domain-error';
import {
  PREFERENCE_MESSAGES,
  isValidPreferenceKey,
  type UserPreferences,
} from '../../domain/preference';
import type { UserPreferenceRepository } from '../ports/user-preference.repository.port';
import type { UserRepository } from '../ports/user.repository.port';
import { loadPreferences } from './get-preferences.use-case';

/**
 * `DELETE /me/preferences/{key}`: removes a stored key so its default applies again ("Restore default
 * columns"). A hard delete of the caller's own row, which the PRD allows. A key never stored is a no-op.
 */
export class ResetPreference {
  constructor(
    private readonly users: UserRepository,
    private readonly preferences: UserPreferenceRepository,
  ) {}

  async execute(actor: CurrentUser, input: { readonly key: string }): Promise<UserPreferences> {
    if (!isValidPreferenceKey(input.key)) {
      throw new ValidationFailedError({
        fieldErrors: { key: [PREFERENCE_MESSAGES.invalidFormat] },
      });
    }
    // No unit of work: a single write and no activity entry (preferences are not audited).
    await this.preferences.remove(actor.userId, input.key);
    return loadPreferences(this.users, this.preferences, actor.userId);
  }
}
