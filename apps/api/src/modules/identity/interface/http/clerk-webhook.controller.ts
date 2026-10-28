import { Controller, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrorResponses } from '../../../../shared/interface/api-error-responses';
import { Public } from '../../../../shared/interface/public.decorator';
import { HandleClerkWebhook } from '../../application/use-cases/handle-clerk-webhook.use-case';
import { ClerkWebhookResponseDto } from './dto/clerk-webhook.dto';

/** `rawBody` is set because `main.ts` boots Nest with `rawBody: true` (Svix signs the exact bytes). */
interface RawBodyRequest {
  readonly rawBody?: Buffer;
}

/**
 * Clerk webhook (C24). Public: there is no JWT, the Svix signature is the credential, and it is verified
 * before any use case runs.
 */
@ApiTags('identity')
@Controller('webhooks')
export class ClerkWebhookController {
  constructor(private readonly handleWebhook: HandleClerkWebhook) {}

  @Public()
  @Post('clerk')
  @HttpCode(200)
  @ApiOperation({
    operationId: 'receiveClerkWebhook',
    summary: 'Clerk user and session events (Svix-signed)',
    description:
      'NOT_FOUND is deliberate: a session.created that arrives before its user.created answers 404 so Svix retries it.',
    security: [],
  })
  @ApiOkResponse({ type: ClerkWebhookResponseDto })
  @ApiErrorResponses('UNAUTHENTICATED', 'NOT_FOUND', 'CONFLICT', 'INTERNAL')
  async receive(
    @Req() request: RawBodyRequest,
    @Headers('svix-id') svixId: string | undefined,
    @Headers('svix-timestamp') svixTimestamp: string | undefined,
    @Headers('svix-signature') svixSignature: string | undefined,
  ): Promise<ClerkWebhookResponseDto> {
    const outcome = await this.handleWebhook.execute({
      rawBody: request.rawBody ?? '',
      headers: { svixId, svixTimestamp, svixSignature },
    });
    return { received: true, outcome };
  }
}
