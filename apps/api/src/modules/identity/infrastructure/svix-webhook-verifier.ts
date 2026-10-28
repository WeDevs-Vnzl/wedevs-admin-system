import { Webhook } from 'svix';
import { UnauthenticatedError } from '../../../shared/domain/domain-error';
import type {
  VerifiedWebhookEvent,
  WebhookHeaders,
  WebhookVerifierPort,
} from '../application/ports/webhook-verifier.port';

/** Verifies Clerk webhooks (signed with Svix) against the raw body. Nothing is trusted before this. */
export class SvixWebhookVerifier implements WebhookVerifierPort {
  private readonly webhook: Webhook;

  constructor(secret: string) {
    this.webhook = new Webhook(secret);
  }

  verify(rawBody: Buffer | string, headers: WebhookHeaders): VerifiedWebhookEvent {
    const { svixId, svixTimestamp, svixSignature } = headers;
    if (!svixId || !svixTimestamp || !svixSignature) throw new UnauthenticatedError();
    const payload = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
    try {
      this.webhook.verify(payload, {
        'svix-id': svixId,
        'svix-timestamp': svixTimestamp,
        'svix-signature': svixSignature,
      });
      const parsed: unknown = JSON.parse(payload);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('not an event');
      const { type, data } = parsed as { type?: unknown; data?: unknown };
      if (typeof type !== 'string' || typeof data !== 'object' || data === null) {
        throw new Error('not an event');
      }
      return { svixId, type, data: data as Record<string, unknown> };
    } catch {
      // Bad or stale signature, tampered or malformed body: all the same to the caller (and to an attacker).
      throw new UnauthenticatedError();
    }
  }
}
