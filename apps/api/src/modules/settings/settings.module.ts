import { Inject, Module, type OnModuleInit } from '@nestjs/common';
import { ACTIVITY_LOG, AUTHORIZATION, UNIT_OF_WORK } from '../../shared/application/ports/tokens';
import type { ActivityLogPort } from '../../shared/application/ports/activity-log.port';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { UnitOfWorkPort } from '../../shared/application/ports/unit-of-work.port';
import { COMPANY_LOGO, type CompanyLogoPort } from './application/ports/company-logo.port';
import { SETTING_REPOSITORY, type SettingRepository } from './application/ports/setting.repository';
import type { FileAccessRegistry } from '../platform/application/file-access.registry';
import { FILE_ACCESS_REGISTRY } from '../platform/application/ports/file-access.port';
import { GetFileSummary } from '../platform/application/use-cases/get-file-summary.use-case';
import { PlatformModule } from '../platform/platform.module';
import { GetCompanySettings } from './application/use-cases/get-company-settings.use-case';
import { UpdateCompanySettings } from './application/use-cases/update-company-settings.use-case';
import { CompanyLogoFileAccessResolver } from './infrastructure/company-logo-file-access.resolver';
import { PlatformCompanyLogoAdapter } from './infrastructure/platform-company-logo.adapter';
import { PrismaSettingRepository } from './infrastructure/prisma-setting.repository';
import { DocumentTypesModule } from './document-types.module';
import { FeaturesModule } from './features.module';
import { FinanceCatalogsModule } from './finance-catalogs.module';
import { TagsModule } from './tags.module';
import { TechnologiesModule } from './technologies.module';
import { CompanySettingsController } from './interface/http/company-settings.controller';

/**
 * Settings aggregator (PRD §8.15): imports the finance catalogs, document types, tags and technologies
 * sub-modules and owns company settings. Reads need only authentication (Q-BE1-3); updates need the `settings`
 * grant. `CompanyLogoPort` is answered by platform's `GetFileSummary`, and the logo is registered in
 * platform's file access registry so any signed-in user can download it.
 */
@Module({
  imports: [
    PlatformModule,
    FinanceCatalogsModule,
    FeaturesModule,
    DocumentTypesModule,
    TagsModule,
    TechnologiesModule,
  ],
  controllers: [CompanySettingsController],
  providers: [
    { provide: SETTING_REPOSITORY, useClass: PrismaSettingRepository },
    {
      provide: COMPANY_LOGO,
      useFactory: (summary: GetFileSummary) => new PlatformCompanyLogoAdapter(summary),
      inject: [GetFileSummary],
    },
    {
      provide: CompanyLogoFileAccessResolver,
      useFactory: (settings: SettingRepository) => new CompanyLogoFileAccessResolver(settings),
      inject: [SETTING_REPOSITORY],
    },
    {
      provide: GetCompanySettings,
      useFactory: (settings: SettingRepository) => new GetCompanySettings(settings),
      inject: [SETTING_REPOSITORY],
    },
    {
      provide: UpdateCompanySettings,
      useFactory: (
        authorization: AuthorizationPort,
        uow: UnitOfWorkPort,
        settings: SettingRepository,
        activityLog: ActivityLogPort,
        logos: CompanyLogoPort,
      ) => new UpdateCompanySettings(authorization, uow, settings, activityLog, logos),
      inject: [AUTHORIZATION, UNIT_OF_WORK, SETTING_REPOSITORY, ACTIVITY_LOG, COMPANY_LOGO],
    },
  ],
})
export class SettingsModule implements OnModuleInit {
  constructor(
    @Inject(FILE_ACCESS_REGISTRY) private readonly registry: FileAccessRegistry,
    private readonly logoResolver: CompanyLogoFileAccessResolver,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.logoResolver);
  }
}
