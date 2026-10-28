import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Webhook } from 'svix';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IDENTITY_PROVIDER } from '../../src/modules/identity/application/ports/identity-provider.port';
import { ClerkWebhookController } from '../../src/modules/identity/interface/http/clerk-webhook.controller';
import { MeController } from '../../src/modules/identity/interface/http/me.controller';
import { UsersController } from '../../src/modules/identity/interface/http/users.controller';
import { IdentityModule } from '../../src/modules/identity/identity.module';
import { readRouteGrant } from '../../src/shared/interface/grant.decorator';
import type { UserRole } from '../../src/shared/domain/enums';
import { createTestPrisma, truncateBusinessTables } from '../support/db';
import { createTestApp } from '../support/test-app';
import { TEST_ENV } from '../support/test-env';
import { FakeIdentityProvider } from './fakes/fake-identity-provider';

const prisma = createTestPrisma();
const identity = new FakeIdentityProvider();
const signer = new Webhook(TEST_ENV.CLERK_WEBHOOK_SECRET as string);
let app: NestExpressApplication;
let counter = 0;

function http() {
  return request(app.getHttpServer());
}

/** Posts a Clerk event signed exactly like Svix does (unique `svix-id` unless given). */
function webhook(
  type: string,
  data: Record<string, unknown>,
  opts: { id?: string; forge?: boolean } = {},
) {
  const body = JSON.stringify({ type, data });
  const id = opts.id ?? `msg_e2e_${++counter}`;
  const now = new Date();
  const signature = opts.forge
    ? 'v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    : signer.sign(id, now, body);
  return http()
    .post('/api/v1/webhooks/clerk')
    .set('content-type', 'application/json')
    .set('svix-id', id)
    .set('svix-timestamp', String(Math.floor(now.getTime() / 1000)))
    .set('svix-signature', signature)
    .send(body);
}

const clerkUser = (id: string, email: string, role?: string) => ({
  id,
  first_name: 'Test',
  last_name: id,
  image_url: null,
  primary_email_address_id: 'idn_1',
  email_addresses: [{ id: 'idn_1', email_address: email }],
  public_metadata: role ? { role } : {},
});

async function seedUser(role: UserRole, tag = role.toLowerCase()) {
  const user = await prisma.user.create({
    data: { clerkId: `clerk_${tag}`, email: `${tag}@example.com`, name: `User ${tag}`, role },
  });
  return { user, token: identity.issue(user.clerkId) };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  await truncateBusinessTables(prisma);
  app = await createTestApp({
    modules: [IdentityModule],
    overrides: [{ token: IDENTITY_PROVIDER, useValue: identity }],
  });
}, 60_000);
beforeEach(async () => {
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  identity.invitations.clear();
  identity.roleMetadata.clear();
  identity.failSetRoleMetadata = false;
});
afterAll(async () => {
  await app.close();
  await prisma.activityLog.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$disconnect();
});

describe('route inventory: every identity route declares its grant', () => {
  it('has exactly one grant declaration per handler, and only the webhook is public', () => {
    const declared: string[] = [];
    for (const controller of [MeController, UsersController, ClerkWebhookController]) {
      const prototype = controller.prototype as unknown as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(prototype)) {
        const handler = prototype[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (!Reflect.getMetadata('path', handler)) continue;
        const grant = readRouteGrant(handler, controller);
        expect(['missing', 'conflict'], `${controller.name}.${name}`).not.toContain(grant.kind);
        declared.push(`${controller.name}.${name}:${grant.kind}`);
      }
    }
    expect(declared.filter((d) => d.endsWith(':public'))).toEqual([
      'ClerkWebhookController.receive:public',
    ]);
    expect(declared).toHaveLength(11);
  });
});

describe('OpenAPI document', () => {
  it('documents every identity route with its operation id, and the webhook without security', async () => {
    const res = await http().get('/api/openapi.json').expect(200);
    const paths = res.body.paths as Record<
      string,
      Record<string, { operationId: string; security?: unknown[] }>
    >;
    const operations = Object.entries(paths).flatMap(([path, methods]) =>
      Object.entries(methods).map(
        ([method, op]) => `${method.toUpperCase()} ${path} ${op.operationId}`,
      ),
    );
    expect(operations).toEqual(
      expect.arrayContaining([
        'GET /api/v1/me getMe',
        'GET /api/v1/me/preferences getMyPreferences',
        'PUT /api/v1/me/preferences/{key} setMyPreference',
        'DELETE /api/v1/me/preferences/{key} resetMyPreference',
        'GET /api/v1/users listUsers',
        'GET /api/v1/users/invitations listUserInvitations',
        'POST /api/v1/users/invitations inviteUser',
        'POST /api/v1/users/invitations/{id}/revoke revokeUserInvitation',
        'GET /api/v1/users/{id} getUser',
        'PATCH /api/v1/users/{id} changeUserRole',
        'POST /api/v1/webhooks/clerk receiveClerkWebhook',
      ]),
    );
    expect(paths['/api/v1/webhooks/clerk']?.post?.security).toEqual([]);
  });
});

describe('authentication (HU-01)', () => {
  it('CA1: a valid token of an unknown clerkId is 401 UNAUTHENTICATED, nothing is provisioned', async () => {
    const res = await http()
      .get('/api/v1/me')
      .set(auth(identity.issue('clerk_uninvited')))
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(await prisma.user.count()).toBe(0);
  });

  it('no token, a garbage token and a revoked-by-deletion user are all 401', async () => {
    await http().get('/api/v1/me').expect(401);
    await http().get('/api/v1/me').set(auth('garbage')).expect(401);
  });

  it('GET /me returns the local profile with the DB role', async () => {
    const { token } = await seedUser('MEMBER');
    const res = await http().get('/api/v1/me').set(auth(token)).expect(200);
    expect(res.body).toMatchObject({ email: 'member@example.com', role: 'MEMBER', imageUrl: null });
    expect(res.body).not.toHaveProperty('clerkId');
  });
});

describe('Clerk webhook (HU-01 CA2, CA4, C24)', () => {
  it('CA2: a signed user.created creates the User with the invited role', async () => {
    const res = await webhook(
      'user.created',
      clerkUser('user_new', 'New@Example.com', 'MEMBER'),
    ).expect(200);
    expect(res.body).toEqual({ received: true, outcome: 'created' });
    const row = await prisma.user.findUniqueOrThrow({ where: { clerkId: 'user_new' } });
    expect(row).toMatchObject({ email: 'new@example.com', role: 'MEMBER' });
    // And that person can now authenticate.
    await http()
      .get('/api/v1/me')
      .set(auth(identity.issue('user_new')))
      .expect(200);
  });

  it('a user.created without role metadata is a VIEWER, never the schema default ADMIN', async () => {
    await webhook('user.created', clerkUser('user_plain', 'plain@example.com')).expect(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { clerkId: 'user_plain' } })).role).toBe(
      'VIEWER',
    );
  });

  it('user.updated changes the profile but never the role', async () => {
    await webhook('user.created', clerkUser('user_u', 'u@example.com', 'ADMIN')).expect(200);
    const updated = { ...clerkUser('user_u', 'u2@example.com', 'OWNER'), first_name: 'Renamed' };
    await webhook('user.updated', updated).expect(200);
    const row = await prisma.user.findUniqueOrThrow({ where: { clerkId: 'user_u' } });
    expect(row).toMatchObject({ email: 'u2@example.com', name: 'Renamed user_u', role: 'ADMIN' });
  });

  it('CA4: session.created writes one LOGIN; the same svix-id twice still one', async () => {
    await seedUser('ADMIN');
    const event = { id: 'sess_1', user_id: 'clerk_admin' };
    const first = await webhook('session.created', event, { id: 'msg_login_1' }).expect(200);
    const again = await webhook('session.created', event, { id: 'msg_login_1' }).expect(200);
    expect([first.body.outcome, again.body.outcome]).toEqual(['recorded', 'duplicate']);
    expect(await prisma.activityLog.count({ where: { action: 'LOGIN' } })).toBe(1);

    await webhook('session.created', event, { id: 'msg_login_2' }).expect(200);
    expect(await prisma.activityLog.count({ where: { action: 'LOGIN' } })).toBe(2);
  });

  it('session.created of a user not yet created answers 404 so Svix redelivers', async () => {
    await webhook('session.created', { id: 's', user_id: 'clerk_early' }).expect(404);
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('user.deleted soft deletes the user and later requests are 401', async () => {
    const { token, user } = await seedUser('VIEWER');
    await http().get('/api/v1/me').set(auth(token)).expect(200);
    const res = await webhook('user.deleted', { id: user.clerkId, deleted: true }).expect(200);
    expect(res.body.outcome).toBe('deleted');
    await http().get('/api/v1/me').set(auth(token)).expect(401);
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).deletedAt,
    ).not.toBeNull();
  });

  it('unknown event types are acknowledged and ignored', async () => {
    const res = await webhook('organization.created', { id: 'org_1' }).expect(200);
    expect(res.body.outcome).toBe('ignored');
    expect(await prisma.activityLog.count()).toBe(0);
  });

  it('a bad signature is 401 and nothing is written', async () => {
    await webhook('user.created', clerkUser('user_x', 'x@example.com', 'OWNER'), {
      forge: true,
    }).expect(401);
    await http()
      .post('/api/v1/webhooks/clerk')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ type: 'user.created', data: clerkUser('user_y', 'y@example.com') }))
      .expect(401);
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.activityLog.count()).toBe(0);
  });
});

describe('users (HU-02 CA1: Owner only)', () => {
  it.each(['ADMIN', 'MEMBER', 'VIEWER'] as const)(
    '%s gets 403 FORBIDDEN on every users route',
    async (role) => {
      const { token } = await seedUser(role);
      const target = await seedUser('MEMBER', 'target');
      const routes = [
        () => http().get('/api/v1/users'),
        () => http().get('/api/v1/users/invitations'),
        () => http().get(`/api/v1/users/${target.user.id}`),
        () => http().patch(`/api/v1/users/${target.user.id}`).send({ role: 'ADMIN' }),
        () =>
          http().post('/api/v1/users/invitations').send({ email: 'n@example.com', role: 'ADMIN' }),
        () => http().post('/api/v1/users/invitations/inv_1/revoke'),
      ];
      for (const route of routes) {
        const res = await route().set(auth(token));
        expect(res.status, `${res.request.method} ${res.request.url}`).toBe(403);
        expect(res.body.error.code).toBe('FORBIDDEN');
      }
      expect((await prisma.user.findUniqueOrThrow({ where: { id: target.user.id } })).role).toBe(
        'MEMBER',
      );
      expect(identity.invitations.size).toBe(0);
    },
  );

  it('a user may read their own detail without being an Owner', async () => {
    const { token, user } = await seedUser('MEMBER');
    await http().get(`/api/v1/users/${user.id}`).set(auth(token)).expect(200);
  });

  it('the Owner lists with search, role filter and sort (envelope per api-contract §3)', async () => {
    const { token } = await seedUser('OWNER');
    await seedUser('ADMIN');
    await seedUser('VIEWER');
    const all = await http().get('/api/v1/users').set(auth(token)).expect(200);
    expect(all.body).toMatchObject({ total: 3, page: 1, pageSize: 25, pageCount: 1 });
    expect(all.body.items.map((u: { role: string }) => u.role)).toEqual([
      'ADMIN',
      'OWNER',
      'VIEWER',
    ]);
    expect(all.body.items[0]).not.toHaveProperty('clerkId');

    const both = await http()
      .get('/api/v1/users?role=ADMIN&role=VIEWER&q=user&sort=email:desc')
      .set(auth(token))
      .expect(200);
    expect(both.body.items.map((u: { email: string }) => u.email)).toEqual([
      'viewer@example.com',
      'admin@example.com',
    ]);

    const bad = await http().get('/api/v1/users?sort=password:asc').set(auth(token)).expect(422);
    expect(bad.body.error.fieldErrors.sort).toEqual(['validation.sort.invalid']);
  });

  it('changes a role (diff in the activity log) and the last Owner cannot be demoted', async () => {
    const { token, user: owner } = await seedUser('OWNER');
    const member = await seedUser('MEMBER');

    const changed = await http()
      .patch(`/api/v1/users/${member.user.id}`)
      .set(auth(token))
      .send({ role: 'ADMIN' })
      .expect(200);
    expect(changed.body.role).toBe('ADMIN');
    expect(identity.roleMetadata.get(member.user.clerkId)).toBe('ADMIN'); // mirrored to the provider
    const entry = await prisma.activityLog.findFirstOrThrow({
      where: { action: 'UPDATE', entityId: member.user.id },
    });
    expect(entry.changes).toEqual({ role: ['MEMBER', 'ADMIN'] });
    expect(entry.actorId).toBe(owner.id);

    const locked = await http()
      .patch(`/api/v1/users/${owner.id}`)
      .set(auth(token))
      .send({ role: 'ADMIN' })
      .expect(409);
    expect(locked.body.error).toMatchObject({
      code: 'INTEGRITY_LOCK',
      message: 'settings.users.errors.lastOwner',
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).role).toBe('OWNER');

    await http().patch('/api/v1/users/nobody').set(auth(token)).send({ role: 'ADMIN' }).expect(404);
    await http()
      .patch(`/api/v1/users/${member.user.id}`)
      .set(auth(token))
      .send({ role: 'GOD' })
      .expect(422);
  });

  it('two Owners demoting each other at once never leave zero Owners (C18)', async () => {
    const a = await seedUser('OWNER', 'owner_a');
    const b = await seedUser('OWNER', 'owner_b');
    const results = await Promise.all([
      http().patch(`/api/v1/users/${b.user.id}`).set(auth(a.token)).send({ role: 'ADMIN' }),
      http().patch(`/api/v1/users/${a.user.id}`).set(auth(b.token)).send({ role: 'ADMIN' }),
    ]);
    expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    expect(await prisma.user.count({ where: { role: 'OWNER' } })).toBeGreaterThanOrEqual(1);
  });

  it('invites, lists and revokes; a duplicate invitation or an existing user is a 409 with the field error', async () => {
    const { token } = await seedUser('OWNER');

    const created = await http()
      .post('/api/v1/users/invitations')
      .set(auth(token))
      .send({ email: 'Nueva@Example.com' })
      .expect(201);
    expect(created.body).toMatchObject({ email: 'nueva@example.com', role: 'ADMIN' });
    expect(
      await prisma.activityLog.count({ where: { action: 'CREATE', entityId: created.body.id } }),
    ).toBe(1);

    const listed = await http().get('/api/v1/users/invitations').set(auth(token)).expect(200);
    expect(listed.body.items.map((i: { id: string }) => i.id)).toEqual([created.body.id]);

    const dup = await http()
      .post('/api/v1/users/invitations')
      .set(auth(token))
      .send({ email: 'nueva@example.com', role: 'MEMBER' })
      .expect(409);
    expect(dup.body.error).toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { email: ['settings.users.errors.emailTaken'] },
    });

    const local = await http()
      .post('/api/v1/users/invitations')
      .set(auth(token))
      .send({ email: 'OWNER@example.com', role: 'MEMBER' })
      .expect(409);
    expect(local.body.error.fieldErrors.email).toEqual(['settings.users.errors.emailTaken']);

    await http()
      .post('/api/v1/users/invitations')
      .set(auth(token))
      .send({ email: 'not-an-email' })
      .expect(422);

    const revoked = await http()
      .post(`/api/v1/users/invitations/${created.body.id}/revoke`)
      .set(auth(token))
      .expect(200);
    expect(revoked.body).toEqual({ invitationId: created.body.id });
    await http()
      .post(`/api/v1/users/invitations/${created.body.id}/revoke`)
      .set(auth(token))
      .expect(404);
  });
});

describe('preferences (own rows only, DT-71)', () => {
  it('round trip: defaults, set, replace, table columns, reset', async () => {
    const { token } = await seedUser('VIEWER');
    const other = await seedUser('ADMIN');

    const defaults = await http().get('/api/v1/me/preferences').set(auth(token)).expect(200);
    expect(defaults.body).toEqual({
      locale: 'es',
      theme: 'system',
      timezone: 'America/Caracas',
      tableColumns: {},
    });

    await http()
      .put('/api/v1/me/preferences/theme')
      .set(auth(token))
      .send({ value: 'dark' })
      .expect(200);
    const replaced = await http()
      .put('/api/v1/me/preferences/theme')
      .set(auth(token))
      .send({ value: 'light' })
      .expect(200);
    expect(replaced.body.theme).toBe('light');
    expect(await prisma.userPreference.count({ where: { key: 'theme' } })).toBe(1);

    const columns = { order: ['name'], visibility: { status: false }, widths: { name: 240 } };
    const withTable = await http()
      .put('/api/v1/me/preferences/table:clients:columns')
      .set(auth(token))
      .send({ value: columns })
      .expect(200);
    expect(withTable.body.tableColumns).toEqual({ clients: columns });

    // Someone else's preferences are never visible nor touched.
    const theirs = await http().get('/api/v1/me/preferences').set(auth(other.token)).expect(200);
    expect(theirs.body.theme).toBe('system');

    const reset = await http()
      .delete('/api/v1/me/preferences/table:clients:columns')
      .set(auth(token))
      .expect(200);
    expect(reset.body.tableColumns).toEqual({});
    expect(reset.body.theme).toBe('light');
  });

  it('rejects an invalid value or key with 422 and field errors; Viewer may use them (authenticated scope)', async () => {
    const { token } = await seedUser('VIEWER');
    const badValue = await http()
      .put('/api/v1/me/preferences/locale')
      .set(auth(token))
      .send({ value: 'fr' })
      .expect(422);
    expect(badValue.body.error.fieldErrors).toEqual({ value: ['validation.invalidOption'] });
    const badKey = await http()
      .put('/api/v1/me/preferences/language')
      .set(auth(token))
      .send({ value: 'x' })
      .expect(422);
    expect(badKey.body.error.fieldErrors.key).toEqual(['validation.invalidFormat']);
    await http().delete('/api/v1/me/preferences/nope').set(auth(token)).expect(422);
    await http().get('/api/v1/me/preferences').expect(401);
  });
});
