import { UNLOCK_COOKIE_MAX_AGE_SECONDS } from '../../application/use-cases/portal/portal-support';

/**
 * The portal's one unlock cookie (DT-45, C22): `httpOnly`, `Secure`, `SameSite=Strict`, scoped to the token's
 * portal path and valid 12 h. Its value is signed by `ShareSecretsPort`; this file only moves it between the
 * `Cookie` / `Set-Cookie` headers, with no cookie dependency. The mock's second cookie existed only for the
 * FE's two paths (page and download route); the browser now calls the API on one path.
 */
export const UNLOCK_COOKIE_NAME = 'wd_portal_unlock';

/** `/api/v1/portal` as the global prefix and the version build it. */
export const PORTAL_PATH = '/api/v1/portal';

/** The raw value of the unlock cookie in a `Cookie` request header, or `undefined`. */
export function readUnlockCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    if (part.slice(0, index).trim() === UNLOCK_COOKIE_NAME) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** The `Set-Cookie` header value for a signed unlock cookie of the link of `token`. */
export function unlockSetCookie(token: string, value: string): string {
  return [
    `${UNLOCK_COOKIE_NAME}=${value}`,
    `Max-Age=${UNLOCK_COOKIE_MAX_AGE_SECONDS}`,
    `Path=${PORTAL_PATH}/${token}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}
