import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CurrentUser as CurrentUserModel } from '../../../../shared/application/current-user';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { CurrentUser } from '../../../../shared/interface/current-user.decorator';
import { Authenticated } from '../../../../shared/interface/grant.decorator';
import { GetShell } from '../../application/use-cases/dashboard/get-shell.use-case';
import { ShellResponseDto } from './shell.dto';

/** What every page needs: the caller, the VES rate chip and the bell counters (`api-contract.md` §8). */
@ApiTags('intelligence')
@Controller('shell')
@Authenticated()
export class ShellController {
  constructor(private readonly getShell: GetShell) {}

  @Get()
  @ApiOperation({
    operationId: 'getShell',
    summary: 'The caller, the VES rate chip and the alert counters',
  })
  @ApiOkResponse({ type: ShellResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  async shell(@CurrentUser() user: CurrentUserModel): Promise<ShellResponseDto> {
    return this.getShell.execute(user);
  }
}
