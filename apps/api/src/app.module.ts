import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { FinanceModule } from './modules/finance/finance.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { McpModule } from './modules/mcp/mcp.module';
import { PlatformModule } from './modules/platform/platform.module';
import { SettingsModule } from './modules/settings/settings.module';
import { SharedInfrastructureModule } from './shared/infrastructure/shared-infrastructure.module';
import { AuthGuard } from './shared/interface/auth.guard';
import { SharedInterfaceModule } from './shared/interface/shared-interface.module';

/**
 * Composition root. `AuthGuard` is global: every route must declare `@Public()`, `@Authenticated()` or
 * `@RequiresGrant()` or it is denied (C13, C24).
 */
@Module({
  imports: [
    AppConfigModule,
    SharedInfrastructureModule,
    SharedInterfaceModule,
    IdentityModule,
    // Before the owning contexts: `/x/overview` must register ahead of `/x/:id` (A1, X13).
    IntelligenceModule,
    PlatformModule,
    SettingsModule,
    CommercialModule,
    FinanceModule,
    DocumentsModule,
    IntegrationsModule,
    McpModule,
  ],
  providers: [{ provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
