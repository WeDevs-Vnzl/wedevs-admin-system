import { randomBytes } from 'node:crypto';
import { Webhook } from 'svix';
import { describe, expect, it } from 'vitest';
import { SvixWebhookVerifier } from './svix-webhook-verifier';

const secret = `whsec_${randomBytes(24).toString('base64')}`;
const body = JSON.stringify({ type: 'user.created', data: { id: 'user_1' } });

function signed(payload = body, at = new Date(), id = 'msg_test_1') {
  const signature = new Webhook(secret).sign(id, at, payload);
  return {
    svixId: id,
    svixTimestamp: String(Math.floor(at.getTime() / 1000)),
    svixSignature: signature,
  };
}

describe('SvixWebhookVerifier', () => {
  const verifier = new SvixWebhookVerifier(secret);

  it('accepts a correctly signed body (string or Buffer) and returns the event', () => {
    const event = { svixId: 'msg_test_1', type: 'user.created', data: { id: 'user_1' } };
    expect(verifier.verify(body, signed())).toEqual(event);
    expect(verifier.verify(Buffer.from(body), signed())).toEqual(event);
  });

  it('rejects a tampered body as UNAUTHENTICATED', () => {
    const headers = signed();
    const tampered = body.replace('user_1', 'user_2');
    expect(() => verifier.verify(tampered, headers)).toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('rejects a stale timestamp (replay)', () => {
    const old = new Date(Date.now() - 10 * 60 * 1000);
    expect(() => verifier.verify(body, signed(body, old))).toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('rejects a signature made with another secret', () => {
    const other = new Webhook(`whsec_${randomBytes(24).toString('base64')}`);
    const at = new Date();
    const headers = {
      svixId: 'msg_test_1',
      svixTimestamp: String(Math.floor(at.getTime() / 1000)),
      svixSignature: other.sign('msg_test_1', at, body),
    };
    expect(() => verifier.verify(body, headers)).toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });

  it('rejects missing headers and a signed body that is not an event', () => {
    expect(() =>
      verifier.verify(body, {
        svixId: undefined,
        svixTimestamp: undefined,
        svixSignature: undefined,
      }),
    ).toThrowError(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    const garbage = 'not json';
    expect(() => verifier.verify(garbage, signed(garbage))).toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
    const noType = JSON.stringify({ data: {} });
    expect(() => verifier.verify(noType, signed(noType))).toThrowError(
      expect.objectContaining({ code: 'UNAUTHENTICATED' }),
    );
  });
});
