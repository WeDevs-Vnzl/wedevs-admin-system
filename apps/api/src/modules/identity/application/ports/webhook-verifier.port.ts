export const WEBHOOK_VERIFIER = Symbol('WEBHOOK_VERIFIER');

export interface WebhookHeaders {
  readonly svixId: string | undefined;
  readonly svixTimestamp: string | undefined;
  readonly svixSignature: string | undefined;
}

/** A webhook whose signature has been verified. `svixId` is the unique event delivery id. */
export interface VerifiedWebhookEvent {
  readonly svixId: string;
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface WebhookVerifierPort {
  /** Throws `UnauthenticatedError` for a missing header, a bad or stale signature or a non-event body. */
  verify(rawBody: Buffer | string, headers: WebhookHeaders): VerifiedWebhookEvent;
}
