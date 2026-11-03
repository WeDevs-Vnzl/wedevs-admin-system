import { Module } from '@nestjs/common';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import { ACTIVITY_LOG, AUTHORIZATION, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { AccountsModule } from '../finance/accounts.module';
import { ListAccounts } from '../finance/application/use-cases/accounts/list-accounts.use-case';
import { SettingsIntegrationsController } from '../integrations/interface/http/settings-integrations.controller';
import {
  INTEGRATION_MAPPING_REFERENCES,
  IntegrationMappingQuery,
  type IntegrationMappingReferences,
} from './application/integration-mapping';
import { CatalogIntegrationMappingReferences } from './application/integration-mapping.references';
import {
  GetIntegrationMapping,
  UpdateIntegrationMapping,
} from './application/integration-mapping.use-cases';
import { PaymentMethodCatalogQuery } from './application/payment-method-catalog.query';
import { SETTING_REPOSITORY, type SettingRepository } from './application/ports/setting.repository';
import { FinanceCatalogsModule } from './finance-catalogs.module';
import { PrismaSettingRepository } from './infrastructure/prisma-setting.repository';

/**
 * Integration mapping (DT-183, DT-184): `GET|PUT /settings/integrations` over the `Setting` row
 * `integrations.mapping`. Exports `IntegrationMappingQuery`, which `integrations` reads through its
 * `IntegrationMappingPort` adapter (DT-110). Self-contained so a spec can load it alone; `AppModule` imports it
 * with the integrations wiring (4.1). Account ids are resolved through finance's exported `ListAccounts` and
 * the payment-method catalog, never their repositories (C14).
 */
@Module({
  imports: [AccountsModule, FinanceCatalogsModule],
  controllers: [SettingsIntegrationsController],
  providers: [
    { provide: SETTING_REPOSITORY, useClass: PrismaSettingRepository },
    {
      provide: IntegrationMappingQuery,
      useFactory: (settings: SettingRepository) => new IntegrationMappingQuery(settings),
      inject: [SETTING_REPOSITORY],
    },
    {
      provide: INTEGRATION_MAPPING_REFERENCES,
      useFactory: (accounts: ListAccounts, methods: PaymentMethodCatalogQuery) =>
        new CatalogIntegrationMappingReferences(accounts, methods),
      inject: [ListAccounts, PaymentMethodCatalogQuery],
    },
    {
      provide: GetIntegrationMapping,
      useFactory: (authorization: AuthorizationPort, query: IntegrationMappingQuery) =>
        new GetIntegrationMapping(authorization, query),
      inject: [AUTHORIZATION, IntegrationMappingQuery],
    },
    {
      provide: UpdateIntegrationMapping,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        settings: SettingRepository,
        references: IntegrationMappingReferences,
        activityLog: ActivityLogPort,
      ) => new UpdateIntegrationMapping(authorization, uow, settings, references, activityLog),
      inject: [
        AUTHORIZATION,
        UNIT_OF_WORK,
        SETTING_REPOSITORY,
        INTEGRATION_MAPPING_REFERENCES,
        ACTIVITY_LOG,
      ],
    },
  ],
  exports: [IntegrationMappingQuery],
})
export class IntegrationMappingModule {}
