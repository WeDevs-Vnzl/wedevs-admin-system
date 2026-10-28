import { describe, expect, it } from 'vitest';
import { FakeWebhookVerifier } from '../../../../../test/identity/fakes/fake-webhook-verifier';
import { createWorld, seedUser } from '../../../../../test/identity/world';
import { HandleClerkWebhook } from './handle-clerk-webhook.use-case';
import { RecordLogin } from './record-login.use-case';
import { SyncClerkUser } from './sync-clerk-user.use-case';

function setup() {
  const world = createWorld();
  const handler = new HandleClerkWebhook(
    new FakeWebhookVerifier(),
    new SyncClerkUser(world.users, world.uow, world.activity, world.clock, world.ids),
    new RecordLogin(world.users, world.logins, world.uow, world.activity),
  );
  const send = (type: string, data: Record<string, unknown>, signature = 'valid') =>
    handler.execute({
      rawBody: JSON.stringify({ type, data }),
      headers: { svixId: 'msg_1', svixTimestamp: '1', svixSignature: signature },
    });
  return { world, send };
}

describe('HandleClerkWebhook', () => {
  it('rejects a bad signature as UNAUTHENTICATED and writes nothing', async () => {
    const { world, send } = setup();
    await expect(
      send(
        'user.created',
        { id: 'u', email_addresses: [{ id: 'i', email_address: 'a@b.co' }] },
        'forged',
      ),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
    expect(world.users.all()).toHaveLength(0);
    expect(world.activity.entries).toHaveLength(0);
  });

  it('routes user.* to the sync and session.created to the login record', async () => {
    const { world, send } = setup();
    expect(
      await send('user.created', {
        id: 'clerk_n',
        email_addresses: [{ id: 'i', email_address: 'n@example.com' }],
        primary_email_address_id: 'i',
        public_metadata: { role: 'MEMBER' },
      }),
    ).toBe('created');
    expect(world.users.all()[0]?.role).toBe('MEMBER');
    expect(await send('session.created', { id: 's', user_id: 'clerk_n' })).toBe('recorded');
  });

  it('acknowledges and ignores event types it does not use', async () => {
    const { world, send } = setup();
    seedUser(world, 'ADMIN');
    expect(await send('email.created', {})).toBe('ignored');
    expect(world.activity.entries).toHaveLength(0);
  });
});
