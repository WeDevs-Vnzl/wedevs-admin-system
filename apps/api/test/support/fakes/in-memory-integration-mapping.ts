import type {
  IntegrationMapping,
  IntegrationMappingPort,
} from '../../../src/modules/integrations/application/ports/integration-mapping.port';

/** Fake `IntegrationMappingPort`: holds whatever the test sets; unconfigured by default. */
export class InMemoryIntegrationMapping implements IntegrationMappingPort {
  private mapping: IntegrationMapping;

  constructor(initial: Partial<IntegrationMapping> = {}) {
    this.mapping = { stripe: null, binance: null, ...initial };
  }

  set(mapping: Partial<IntegrationMapping>): void {
    this.mapping = { stripe: null, binance: null, ...mapping };
  }

  async load(): Promise<IntegrationMapping> {
    return this.mapping;
  }
}
