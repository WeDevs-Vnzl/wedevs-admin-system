import { Injectable } from '@nestjs/common';
import { IntegrationMappingQuery } from '../../settings/application/integration-mapping';
import type {
  IntegrationMapping,
  IntegrationMappingPort,
} from '../application/ports/integration-mapping.port';

/**
 * `IntegrationMappingPort` over the `settings` export `IntegrationMappingQuery` (DT-110). The ids were
 * resolved when the Owner saved them (C14); finance checks them again when a payment is written.
 */
@Injectable()
export class SettingsIntegrationMapping implements IntegrationMappingPort {
  constructor(private readonly query: IntegrationMappingQuery) {}

  async load(): Promise<IntegrationMapping> {
    const mapping = await this.query.read();
    return { stripe: mapping.stripe, binance: mapping.binance };
  }
}
