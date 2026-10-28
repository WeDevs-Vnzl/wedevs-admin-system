import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { CurrentUser as CurrentUserModel } from '../../src/shared/application/current-user';
import { actorOf } from '../../src/shared/application/actor';
import type { ActivityLogPort } from '../../src/shared/application/ports/activity-log.port';
import {
  assertCan,
  type AuthorizationPort,
} from '../../src/shared/application/ports/authorization.port';
import {
  ACTIVITY_LOG,
  AUTHORIZATION,
  UNIT_OF_WORK,
} from '../../src/shared/application/ports/tokens';
import type { UnitOfWorkPort } from '../../src/shared/application/ports/unit-of-work.port';
import { CurrentUser } from '../../src/shared/interface/current-user.decorator';
import { DomainError, ERROR_CODE_VALUES, type ErrorCode } from '../../src/shared/domain';
import { Authenticated, RequiresGrant } from '../../src/shared/interface/grant.decorator';
import { createListQueryDto } from '../../src/shared/interface/list-query.dto';
import { Public } from '../../src/shared/interface/public.decorator';

class ProbeBodyDto extends createZodDto(
  z.object({ name: z.string().min(1), amount: z.number().int().min(0) }),
) {}

class ProbeListQueryDto extends createListQueryDto({
  sortFields: ['name', 'createdAt'],
  defaultSort: { field: 'createdAt', direction: 'desc' },
}) {}

/** Test-only routes that exercise the error filter, the validation pipe and the list query. */
@Controller('probe')
export class ProbeController {
  @Public()
  @Get('error/:code')
  throwDomain(@Param('code') code: string): never {
    if (!(ERROR_CODE_VALUES as readonly string[]).includes(code)) throw new Error('unknown code');
    throw new DomainError(code as ErrorCode, {
      ...(code === 'VALIDATION' ? { fieldErrors: { name: ['validation.required'] } } : {}),
      ...(code === 'CONFLICT'
        ? { entity: { type: 'Client', id: 'cl_1', label: 'Acme' } as never }
        : {}),
    });
  }

  @Public()
  @Get('raw-error')
  throwRaw(): never {
    throw new Error('secret internal detail: password=hunter2');
  }

  @Public()
  @Post('body')
  body(@Body() body: ProbeBodyDto): ProbeBodyDto {
    return body;
  }

  @Public()
  @Get('list')
  list(@Query() query: ProbeListQueryDto): unknown {
    return query;
  }
}

/** Routes that prove the global guard end to end. */
@Controller('probe/auth')
export class ProbeAuthController {
  @Authenticated()
  @Get('authenticated')
  authenticated(@CurrentUser() user: CurrentUserModel): { userId: string } {
    return { userId: user.userId };
  }

  @RequiresGrant('invoice', 'read')
  @Get('grant')
  grant(): { ok: true } {
    return { ok: true };
  }

  @Get('undeclared')
  undeclared(): { ok: true } {
    return { ok: true };
  }

  @Public()
  @Authenticated()
  @Get('double')
  double(): { ok: true } {
    return { ok: true };
  }
}

/**
 * Stand-in for a financial use case (HU-02 CA2): authorizes with `assertCan`, then writes one activity
 * entry, so an unchanged `ActivityLog` count proves the denied caller never reached the write.
 */
@Injectable()
export class ProbeCreateInvoice {
  constructor(
    @Inject(AUTHORIZATION) private readonly authorization: AuthorizationPort,
    @Inject(UNIT_OF_WORK) private readonly uow: UnitOfWorkPort,
    @Inject(ACTIVITY_LOG) private readonly activity: ActivityLogPort,
  ) {}

  async execute(user: CurrentUserModel): Promise<{ ok: true }> {
    assertCan(this.authorization, user, 'create', 'invoice');
    await this.uow.run(() =>
      this.activity.record({
        actor: actorOf(user),
        action: 'CREATE',
        entityType: 'INVOICE',
        entityId: 'probe_invoice',
        entityLabel: 'Probe invoice',
      }),
    );
    return { ok: true };
  }
}

@Controller('probe/invoices')
export class ProbeInvoiceController {
  constructor(private readonly createInvoice: ProbeCreateInvoice) {}

  @RequiresGrant('invoice', 'create')
  @Post()
  create(@CurrentUser() user: CurrentUserModel): Promise<{ ok: true }> {
    return this.createInvoice.execute(user);
  }
}

@Module({
  controllers: [ProbeController, ProbeAuthController, ProbeInvoiceController],
  providers: [ProbeCreateInvoice],
})
export class ProbeModule {}
