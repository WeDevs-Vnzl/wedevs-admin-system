import { createHash } from 'node:crypto';
import { v2 as cloudinary } from 'cloudinary';
import { describe, expect, it } from 'vitest';
import { FixedClock } from '../../../../test/support/fakes/fixed-clock';
import { CloudinaryFileStorage } from './cloudinary-file-storage.adapter';

const credentials = {
  cloudName: 'demo-cloud',
  apiKey: '123456789012345',
  apiSecret: 'dummy-secret',
};
const clock = new FixedClock('2026-10-25T10:00:00.000Z');
const NOW_SECONDS = Math.floor(new Date('2026-10-25T10:00:00.000Z').getTime() / 1000);

interface Call {
  url: string;
  init: RequestInit | undefined;
}

/** A stubbed `fetch`: records calls and answers from a queue. No request ever leaves the process. */
function stubFetch(...responses: Response[]) {
  const calls: Call[] = [];
  const http = ((url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('unexpected request'));
    return Promise.resolve(next);
  }) as typeof fetch;
  return { http, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Cloudinary signature (docs vector)', () => {
  it('matches the documented example for api_secret "abcd"', () => {
    // Cloudinary docs, "Generating authentication signatures".
    const params = {
      eager: 'w_400,h_300,c_pad|w_260,h_200,c_crop',
      public_id: 'sample_image',
      timestamp: 1315060510,
    };
    expect(cloudinary.utils.api_sign_request(params, 'abcd')).toBe(
      'bfd09f95f331f558cbd1320e67aa8d488770583e',
    );
  });
});

describe('CloudinaryFileStorage', () => {
  it('reports the cloud name as the bucket', () => {
    expect(new CloudinaryFileStorage(credentials, clock).bucket).toBe('demo-cloud');
  });

  it('signs the upload intent for a private (authenticated) raw asset, never exposing the secret', async () => {
    const storage = new CloudinaryFileStorage(credentials, clock);
    const expiresAt = new Date('2026-10-25T10:05:00.000Z');
    const intent = await storage.createUploadIntent({
      storageKey: 'general/2026/10/abc',
      context: 'general',
      expiresAt,
    });

    expect(intent.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/raw/upload');
    expect(intent.expiresAt).toBe(expiresAt);
    expect(intent.fields).toMatchObject({
      api_key: credentials.apiKey,
      public_id: 'general/2026/10/abc',
      type: 'authenticated',
      timestamp: String(NOW_SECONDS),
    });
    const expected = createHash('sha1')
      .update(
        `public_id=general/2026/10/abc&timestamp=${NOW_SECONDS}&type=authenticated${credentials.apiSecret}`,
      )
      .digest('hex');
    expect(intent.fields.signature).toBe(expected);
    expect(JSON.stringify(intent)).not.toContain(credentials.apiSecret);
  });

  it('reads the byte size through the Admin API with basic auth, and null on 404', async () => {
    const { http, calls } = stubFetch(json({ bytes: 4096 }), json({ error: {} }, 404));
    const storage = new CloudinaryFileStorage(credentials, clock, http);

    expect(await storage.getObjectInfo('general/2026/10/abc')).toEqual({ bytes: 4096 });
    expect(calls[0]?.url).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/resources/raw/authenticated/general/2026/10/abc',
    );
    const auth = (calls[0]?.init?.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from('123456789012345:dummy-secret').toString('base64')}`);

    expect(await storage.getObjectInfo('general/2026/10/gone')).toBeNull();
  });

  it('fails on other statuses without leaking the URL or credentials', async () => {
    const { http } = stubFetch(json({}, 500));
    const storage = new CloudinaryFileStorage(credentials, clock, http);
    await expect(storage.getObjectInfo('k')).rejects.toThrow(
      'Cloudinary resource lookup failed (500)',
    );
  });

  it('reads only the head of the object with a Range request on a signed delivery URL', async () => {
    const body = new Uint8Array(10_000).fill(7);
    const { http, calls } = stubFetch(new Response(body, { status: 200 }));
    const storage = new CloudinaryFileStorage(credentials, clock, http);

    const head = await storage.readHead('general/2026/10/abc', 4100);

    expect(head.byteLength).toBe(4100);
    expect(calls[0]?.url).toMatch(
      /^https:\/\/res\.cloudinary\.com\/demo-cloud\/raw\/authenticated\/s--[\w-]{8}--\/(v1\/)?general\/2026\/10\/abc/,
    );
    expect((calls[0]?.init?.headers as Record<string, string>).Range).toBe('bytes=0-4099');
  });

  it('returns a short object whole', async () => {
    const { http } = stubFetch(new Response(new Uint8Array([1, 2, 3]), { status: 206 }));
    const head = await new CloudinaryFileStorage(credentials, clock, http).readHead('k', 4100);
    expect([...head]).toEqual([1, 2, 3]);
  });

  it('builds a signed, expiring, attachment download URL', async () => {
    const storage = new CloudinaryFileStorage(credentials, clock);
    const expiresAt = new Date('2026-10-25T10:01:00.000Z');
    const url = new URL(
      await storage.signedDownloadUrl('general/2026/10/abc', {
        fileName: 'Contrato.pdf',
        expiresAt,
      }),
    );

    expect(`${url.origin}${url.pathname}`).toBe(
      'https://api.cloudinary.com/v1_1/demo-cloud/raw/download',
    );
    expect(url.searchParams.get('public_id')).toBe('general/2026/10/abc');
    expect(url.searchParams.get('type')).toBe('authenticated');
    expect(url.searchParams.get('attachment')).toBe('Contrato.pdf');
    expect(url.searchParams.get('expires_at')).toBe(String(Math.floor(expiresAt.getTime() / 1000)));
    expect(url.searchParams.get('api_key')).toBe(credentials.apiKey);
    expect(url.searchParams.get('signature')).toMatch(/^[0-9a-f]{40}$/);
    expect(url.toString()).not.toContain(credentials.apiSecret);
  });

  it('destroys with a signed form POST and treats "not found" as success', async () => {
    const { http, calls } = stubFetch(json({ result: 'ok' }), json({ result: 'not found' }));
    const storage = new CloudinaryFileStorage(credentials, clock, http);

    await storage.destroy('general/2026/10/abc');
    await storage.destroy('general/2026/10/abc');

    expect(calls[0]?.url).toBe('https://api.cloudinary.com/v1_1/demo-cloud/raw/destroy');
    expect(calls[0]?.init?.method).toBe('POST');
    const form = new URLSearchParams(String(calls[0]?.init?.body));
    expect(form.get('public_id')).toBe('general/2026/10/abc');
    expect(form.get('type')).toBe('authenticated');
    expect(form.get('api_key')).toBe(credentials.apiKey);
    expect(form.get('signature')).toMatch(/^[0-9a-f]{40}$/);
    expect(form.has('api_secret')).toBe(false);
  });

  it('fails when destroy is refused or answers something unexpected', async () => {
    const { http } = stubFetch(json({}, 401), json({ result: 'weird' }));
    const storage = new CloudinaryFileStorage(credentials, clock, http);
    await expect(storage.destroy('k')).rejects.toThrow('Cloudinary destroy failed (401)');
    await expect(storage.destroy('k')).rejects.toThrow('Cloudinary destroy: unexpected result');
  });
});
