import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import { AUTHORIZATION } from '../../shared/application/ports/tokens';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { ACTIVITY_READ, type ActivityReadPort } from './application/ports/activity-read.port';
import { ListActivity } from './application/use-cases/list-activity.use-case';
import { PrismaActivityReadAdapter } from './infrastructure/prisma-activity-read.adapter';
import { ActivityController } from './interface/http/activity.controller';

/**
 * Platform activity listing (`GET /activity`). The only place that binds `ACTIVITY_READ`. Wired into
 * `AppModule` by package 4.1; `AUTHORIZATION` comes from the global identity module.
 */
@Module({
  imports: [SharedInterfaceModule],
  controllers: [ActivityController],
  providers: [
    { provide: ACTIVITY_READ, useClass: PrismaActivityReadAdapter },
    {
      provide: ListActivity,
      useFactory: (authorization: AuthorizationPort, activity: ActivityReadPort) =>
        new ListActivity(authorization, activity),
      inject: [AUTHORIZATION, ACTIVITY_READ],
    },
  ],
})
export class ActivityModule {}
