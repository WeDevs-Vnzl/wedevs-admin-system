import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { Public } from '../../../../shared/interface/public.decorator';
import { GetHealth } from '../../application/use-cases/get-health.use-case';
import { HealthResponseDto } from './dto/health.dto';

@ApiTags('platform')
@Controller('health')
export class HealthController {
  constructor(private readonly getHealth: GetHealth) {}

  @Public()
  @Get()
  @ApiOperation({
    operationId: 'getHealth',
    summary: 'Liveness and database readiness',
    security: [],
  })
  @ApiOkResponse({ description: 'Service and database are up', type: HealthResponseDto })
  @ApiErrorResponses('INTERNAL')
  async get(): Promise<HealthResponseDto> {
    return this.getHealth.execute();
  }
}
