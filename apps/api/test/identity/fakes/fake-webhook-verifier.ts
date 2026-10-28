import type {
  VerifiedWebhookEvent,
  WebhookHeaders,
  WebhookVerifierPort,
} from '../../../src/modules/identity/application/ports/webhook-verifier.port';
import { UnauthenticatedError } from '../../../src/shared/domain/domain-error';

/** Accepts a body signed with the literal signature `valid`; the body is the JSON `{ type, data }`. */
export class FakeWebhookVerifier implements WebhookVerifierPort {
  verify(rawBody: Buffer | string, headers: WebhookHeaders): VerifiedWebhookEvent {
    if (headers.svixSignature !== 'valid' || !headers.svixId) throw new UnauthenticatedError();
    const parsed = JSON.parse(rawBody.toString()) as {
      type: string;
      data: Record<string, unknown>;
    };
    return { svixId: headers.svixId, type: parsed.type, data: parsed.data };
  }
}
