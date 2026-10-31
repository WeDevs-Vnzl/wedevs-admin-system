import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfigModule } from './config/config.module';
import { CommercialModule } from './modules/commercial/commercial.module';
import { FinanceModule } from './modules/finance/finance.module';
import { IdentityModule } from './modules/identity/identity.module';
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
    PlatformModule,
    SettingsModule,
    CommercialModule,
    FinanceModule,
  ],
  providers: [{ provide: APP_GUARD, useExisting: AuthGuard }],
})
export class AppModule {}
