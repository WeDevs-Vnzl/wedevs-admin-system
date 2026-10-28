import { createSign, generateKeyPairSync, type KeyObject } from 'node:crypto';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClerkIdentityProvider } from './clerk-identity-provider';

const APP_URL = 'http://localhost:3001';
const API_URL = 'https://clerk.test.invalid';

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

function pair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privateKey };
}

function signJwt(privateKey: KeyObject, claims: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'ins_test' }));
  const payload = b64url(JSON.stringify(claims));
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

const now = () => Math.floor(Date.now() / 1000);
const claims = (over: Record<string, unknown> = {}) => ({
  sub: 'user_clerk_1',
  azp: APP_URL,
  sid: 'sess_1',
  iss: 'https://clerk.example.com',
  iat: now() - 10,
  nbf: now() - 10,
  exp: now() + 300,
  ...over,
});

describe('ClerkIdentityProvider.verifySessionToken (networkless)', () => {
  let keys: ReturnType<typeof pair>;
  let provider: ClerkIdentityProvider;
  beforeAll(() => {
    keys = pair();
    provider = new ClerkIdentityProvider({
      secretKey: 'sk_test_fake_not_a_real_key',
      jwtKey: keys.publicPem,
      appUrl: `${APP_URL}/`,
      apiUrl: API_URL,
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('accepts a valid token and returns the clerk id (and never touches the network)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const token = signJwt(keys.privateKey, claims());
    expect(await provider.verifySessionToken(token)).toEqual({ clerkId: 'user_clerk_1' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects an expired token', async () => {
    const token = signJwt(
      keys.privateKey,
      claims({ exp: now() - 600, iat: now() - 900, nbf: now() - 900 }),
    );
    expect(await provider.verifySessionToken(token)).toBeNull();
  });

  it('rejects a token whose azp is not APP_URL', async () => {
    const token = signJwt(keys.privateKey, claims({ azp: 'https://evil.example.com' }));
    expect(await provider.verifySessionToken(token)).toBeNull();
  });

  it('rejects a token signed by another key', async () => {
    const other = pair();
    expect(await provider.verifySessionToken(signJwt(other.privateKey, claims()))).toBeNull();
  });

  it('rejects a tampered payload, a token without sub and garbage', async () => {
    const token = signJwt(keys.privateKey, claims());
    const [h, , s] = token.split('.');
    const forged = `${h}.${b64url(JSON.stringify(claims({ sub: 'user_other' })))}.${s}`;
    expect(await provider.verifySessionToken(forged)).toBeNull();
    expect(
      await provider.verifySessionToken(signJwt(keys.privateKey, claims({ sub: undefined }))),
    ).toBeNull();
    expect(await provider.verifySessionToken('not.a.jwt')).toBeNull();
    expect(await provider.verifySessionToken('')).toBeNull();
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'clerk-trace-id': 'trace_test' },
  });
}

const invitationJson = (over: Record<string, unknown> = {}) => ({
  object: 'invitation',
  id: 'inv_1',
  email_address: 'nueva@example.com',
  public_metadata: { role: 'MEMBER' },
  status: 'pending',
  revoked: false,
  created_at: 1_767_225_600_000,
  updated_at: 1_767_225_600_000,
  ...over,
});

describe('ClerkIdentityProvider Clerk API calls (HTTP stubbed)', () => {
  const provider = new ClerkIdentityProvider({
    secretKey: 'sk_test_fake_not_a_real_key',
    jwtKey: pair().publicPem,
    appUrl: APP_URL,
    apiUrl: API_URL,
  });
  const calls: { url: string; method: string; body: unknown; auth: string | null }[] = [];

  function stub(handler: (url: URL) => Response) {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn((input: Request | string | URL, init?: RequestInit) => {
        const request = input instanceof Request ? input : null;
        const url = new URL(request ? request.url : String(input));
        const headers = new Headers(request?.headers ?? init?.headers);
        const rawBody = init?.body ?? null;
        calls.push({
          url: url.pathname + url.search,
          method: request?.method ?? init?.method ?? 'GET',
          body: typeof rawBody === 'string' ? JSON.parse(rawBody) : rawBody,
          auth: headers.get('authorization'),
        });
        return Promise.resolve(handler(url));
      }),
    );
  }
  afterEach(() => vi.unstubAllGlobals());

  it('createInvitation sends the role as public metadata with the APP_URL redirect', async () => {
    stub(() => jsonResponse(invitationJson()));
    const invitation = await provider.createInvitation('nueva@example.com', 'MEMBER');

    expect(invitation).toEqual({
      id: 'inv_1',
      email: 'nueva@example.com',
      role: 'MEMBER',
      createdAt: new Date(1_767_225_600_000),
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v1/invitations' });
    expect(calls[0]?.body).toMatchObject({
      email_address: 'nueva@example.com',
      public_metadata: { role: 'MEMBER' },
      redirect_url: APP_URL,
      ignore_existing: false,
    });
  });

  it('a duplicate invitation becomes CONFLICT with the emailTaken field error', async () => {
    stub(() =>
      jsonResponse(
        { errors: [{ code: 'duplicate_record', message: 'dup', long_message: 'dup' }] },
        422,
      ),
    );
    await expect(provider.createInvitation('nueva@example.com', 'ADMIN')).rejects.toMatchObject({
      code: 'CONFLICT',
      fieldErrors: { email: ['settings.users.errors.emailTaken'] },
    });
  });

  it('a malformed e-mail becomes VALIDATION; an unexpected failure is opaque and carries no key', async () => {
    stub(() =>
      jsonResponse({ errors: [{ code: 'form_param_format_invalid', message: 'bad' }] }, 422),
    );
    await expect(provider.createInvitation('bad', 'ADMIN')).rejects.toMatchObject({
      code: 'VALIDATION',
    });

    stub(() => jsonResponse({ errors: [{ code: 'boom', message: 'boom' }] }, 500));
    const error = await provider
      .createInvitation('a@example.com', 'ADMIN')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toMatch(/sk_test|Bearer/);
    expect(String((error as Error).message)).toContain('500');
  });

  it('listPendingInvitations asks for pending ones, at most 100, and maps them', async () => {
    stub(() =>
      jsonResponse({
        data: [invitationJson(), invitationJson({ id: 'inv_2', public_metadata: {} })],
        total_count: 2,
      }),
    );
    const list = await provider.listPendingInvitations();
    expect(list.map((i) => [i.id, i.role])).toEqual([
      ['inv_1', 'MEMBER'],
      ['inv_2', 'VIEWER'],
    ]);
    expect(calls[0]?.url).toContain('status=pending');
    expect(calls[0]?.url).toContain('limit=100');
  });

  it('revokeInvitation returns the invitation and maps a missing one to NOT_FOUND', async () => {
    stub(() => jsonResponse(invitationJson({ status: 'revoked', revoked: true })));
    expect((await provider.revokeInvitation('inv_1')).email).toBe('nueva@example.com');
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/v1/invitations/inv_1/revoke' });

    stub(() => jsonResponse({ errors: [{ code: 'resource_not_found', message: 'nope' }] }, 404));
    await expect(provider.revokeInvitation('inv_x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('setRoleMetadata merges the role into the public metadata of the Clerk user', async () => {
    stub(() => jsonResponse({ object: 'user', id: 'user_clerk_1' }));
    await provider.setRoleMetadata('user_clerk_1', 'ADMIN');
    expect(calls[0]).toMatchObject({ method: 'PATCH', url: '/v1/users/user_clerk_1/metadata' });
    expect(calls[0]?.body).toMatchObject({ public_metadata: { role: 'ADMIN' } });
  });
});
