import { Controller, Headers, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SYSTEM_ACTOR } from '../../../../shared/application/actor';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { Public } from '../../../../shared/interface/public.decorator';
import { HandleStripeWebhook } from '../../application/use-cases/stripe/handle-stripe-webhook.use-case';
import { assertStripeEnabled, STRIPE_ENABLED } from './payment-links.availability';
import { StripeWebhookResponseDto } from './webhooks.dto';

/** `rawBody` is set because `main.ts` boots Nest with `rawBody: true` (Stripe signs the exact bytes). */
interface RawBodyRequest {
  readonly rawBody?: Buffer;
}

/**
 * Stripe webhook (C24, DT-190: the only `@Public()` route this batch adds). There is no JWT: the signature is
 * the credential and it is verified before anything is parsed or written (a bad one answers 401
 * `UNAUTHENTICATED`). Off (404) when Stripe is not configured (choice 3). The use case runs as `SYSTEM` (DT-130).
 */
@ApiTags('integrations')
@Controller('webhooks')
export class StripeWebhookController {
  constructor(
    private readonly handleWebhook: HandleStripeWebhook,
    @Inject(STRIPE_ENABLED) private readonly enabled: boolean,
  ) {}

  @Public()
  @Post('stripe')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'receiveStripeWebhook',
    summary: 'Stripe payment events (signature-verified)',
    description:
      'Answers 200 for processed, duplicate, ignored and parked events; 401 for a bad signature (nothing is written); 404 when Stripe is not configured; 500 only on an unexpected failure so Stripe retries.',
    security: [],
  })
  @ApiOkResponse({ type: StripeWebhookResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'INTERNAL')
  async receive(
    @Req() request: RawBodyRequest,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ): Promise<StripeWebhookResponseDto> {
    assertStripeEnabled(this.enabled);
    const outcome = await this.handleWebhook.execute(SYSTEM_ACTOR, {
      rawBody: request.rawBody ?? '',
      headers,
    });
    return { received: true, outcome };
  }
}
