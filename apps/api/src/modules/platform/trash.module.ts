import { Module } from '@nestjs/common';
import type { AuthorizationPort } from '../../shared/application/ports/authorization.port';
import type { ClockPort } from '../../shared/application/ports/clock.port';
import { AUTHORIZATION, CLOCK } from '../../shared/application/ports/tokens';
import { SharedInterfaceModule } from '../../shared/interface/shared-interface.module';
import { RESTORE_HANDLER_REGISTRY } from './application/ports/restore-handler.port';
import { TRASH_READ, type TrashReadPort } from './application/ports/trash-read.port';
import { RestoreHandlerRegistry } from './application/restore-handler.registry';
import { ListTrash } from './application/use-cases/list-trash.use-case';
import { RestoreFromTrash } from './application/use-cases/restore-from-trash.use-case';
import { PrismaTrashRead } from './infrastructure/prisma-trash-read.adapter';
import { TrashController } from './interface/http/trash.controller';

/**
 * Platform trash (PRD §7.7). Exports `RESTORE_HANDLER_REGISTRY`: each context imports this module and
 * registers its `RestoreHandler`s from its own `onModuleInit` (the BE-1 `FileAccessRegistry` pattern).
 */
@Module({
  imports: [SharedInterfaceModule],
  controllers: [TrashController],
  providers: [
    { provide: TRASH_READ, useClass: PrismaTrashRead },
    { provide: RESTORE_HANDLER_REGISTRY, useClass: RestoreHandlerRegistry },
    {
      provide: ListTrash,
      useFactory: (
        authorization: AuthorizationPort,
        registry: RestoreHandlerRegistry,
        trash: TrashReadPort,
      ) => new ListTrash(authorization, registry, trash),
      inject: [AUTHORIZATION, RESTORE_HANDLER_REGISTRY, TRASH_READ],
    },
    {
      provide: RestoreFromTrash,
      useFactory: (
        authorization: AuthorizationPort,
        registry: RestoreHandlerRegistry,
        clock: ClockPort,
      ) => new RestoreFromTrash(authorization, registry, clock),
      inject: [AUTHORIZATION, RESTORE_HANDLER_REGISTRY, CLOCK],
    },
  ],
  exports: [RESTORE_HANDLER_REGISTRY],
})
export class TrashModule {}
