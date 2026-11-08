import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { FEATURES } from '../../../../config/config.module';
import type { FeaturesView } from '../../../../config/env.schema';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { Authenticated } from '../../../../shared/interface/grant.decorator';

export class FeaturesResponseDto extends createZodDto(
  z.object({ stripe: z.boolean(), binance: z.boolean(), bankSync: z.boolean() }),
) {}

/**
 * The effective integration feature flags (DT-227), so the FE hides what the BE refuses. Any signed-in user;
 * booleans only, never a key.
 */
@ApiTags('settings')
@Controller('features')
@Authenticated()
export class FeaturesController {
  constructor(@Inject(FEATURES) private readonly features: FeaturesView) {}

  @Get()
  @ApiOperation({ operationId: 'getFeatures', summary: 'Effective integration feature flags' })
  @ApiOkResponse({ type: FeaturesResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'INTERNAL')
  get(): FeaturesResponseDto {
    return { ...this.features };
  }
}
