import type {
  VerifiedWebhookEvent,
  WebhookHeaders,
  WebhookVerifierPort,
} from '../ports/webhook-verifier.port';
import type { RecordLogin } from './record-login.use-case';
import {
  CLERK_USER_EVENT_TYPES,
  type ClerkUserEventType,
  type SyncClerkUser,
} from './sync-clerk-user.use-case';

export interface ClerkWebhookInput {
  readonly rawBody: Buffer | string;
  readonly headers: WebhookHeaders;
}

export type ClerkWebhookOutcome =
  'created' | 'updated' | 'deleted' | 'unchanged' | 'recorded' | 'duplicate' | 'ignored';

function isUserEvent(type: string): type is ClerkUserEventType {
  return (CLERK_USER_EVENT_TYPES as readonly string[]).includes(type);
}

/**
 * `POST /webhooks/clerk`. The signature is verified before anything else (nothing is written for an
 * unsigned or tampered call); event types the app does not use are acknowledged and ignored.
 */
export class HandleClerkWebhook {
  constructor(
    private readonly verifier: WebhookVerifierPort,
    private readonly sync: SyncClerkUser,
    private readonly recordLogin: RecordLogin,
  ) {}

  async execute(input: ClerkWebhookInput): Promise<ClerkWebhookOutcome> {
    const event: VerifiedWebhookEvent = this.verifier.verify(input.rawBody, input.headers);
    if (isUserEvent(event.type)) return this.sync.execute({ type: event.type, data: event.data });
    if (event.type === 'session.created') {
      return this.recordLogin.execute({ svixId: event.svixId, data: event.data });
    }
    return 'ignored';
  }
}
