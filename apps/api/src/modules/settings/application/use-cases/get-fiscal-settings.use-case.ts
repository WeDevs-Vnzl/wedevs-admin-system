import type { CurrentUser } from '../../../../shared/application/current-user';
import type { FiscalSettings } from '../../domain/fiscal-settings';
import type { FiscalSettingsQuery } from '../fiscal-settings.query';

/**
 * Reads the fiscal parameters (PRD §8.15). Authorization is the route's `@Authenticated()` declaration: a reference
 * read every signed-in role needs (DT-71), with no `can()` action.
 */
export class GetFiscalSettings {
  constructor(private readonly query: FiscalSettingsQuery) {}

  async execute(_actor: CurrentUser): Promise<FiscalSettings> {
    return this.query.read();
  }
}
