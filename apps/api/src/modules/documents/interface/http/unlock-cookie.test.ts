import { describe, expect, it } from 'vitest';
import { PORTAL_HEADERS, PortalHeadersMiddleware } from './portal-headers.middleware';
import { readUnlockCookie, unlockSetCookie, UNLOCK_COOKIE_NAME } from './unlock-cookie';

// Ported from `server/portal/{unlock-cookie,headers}.test.ts`: the cookie attributes and the C22 headers. The
// signature, expiry and forgery cases live with `NodeShareSecrets` and the portal use-case tests.

const TOKEN = 'T'.repeat(43);

describe('unlockSetCookie', () => {
  it('is httpOnly, Secure, SameSite=Strict, scoped to the token path and lasts 12 hours', () => {
    const header = unlockSetCookie(TOKEN, 'abc.def');
    expect(header.split('; ')).toEqual([
      `${UNLOCK_COOKIE_NAME}=abc.def`,
      'Max-Age=43200',
      `Path=/api/v1/portal/${TOKEN}`,
      'HttpOnly',
      'Secure',
      'SameSite=Strict',
    ]);
  });
});

describe('readUnlockCookie', () => {
  it('reads the cookie among others, with or without spaces', () => {
    expect(readUnlockCookie(`a=1; ${UNLOCK_COOKIE_NAME}=x.y; b=2`)).toBe('x.y');
    expect(readUnlockCookie(`${UNLOCK_COOKIE_NAME}=x.y`)).toBe('x.y');
    expect(readUnlockCookie(`a=1;${UNLOCK_COOKIE_NAME}=x.y;b=2`)).toBe('x.y');
  });

  it('answers undefined when the header or the cookie is missing or malformed', () => {
    expect(readUnlockCookie(undefined)).toBeUndefined();
    expect(readUnlockCookie('')).toBeUndefined();
    expect(readUnlockCookie('a=1; b=2')).toBeUndefined();
    expect(readUnlockCookie('garbage')).toBeUndefined();
    expect(readUnlockCookie(`x${UNLOCK_COOKIE_NAME}=1`)).toBeUndefined();
  });

  it('keeps an = inside the value', () => {
    expect(readUnlockCookie(`${UNLOCK_COOKIE_NAME}=a=b`)).toBe('a=b');
  });
});

describe('PortalHeadersMiddleware', () => {
  it('sets the three C22 headers and calls next', () => {
    const headers: Record<string, string> = {};
    let called = false;
    new PortalHeadersMiddleware().use(
      {} as never,
      { setHeader: (name: string, value: string) => (headers[name] = value) } as never,
      () => (called = true),
    );
    expect(headers).toEqual({
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'private, no-store',
    });
    expect(PORTAL_HEADERS['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(called).toBe(true);
  });
});
