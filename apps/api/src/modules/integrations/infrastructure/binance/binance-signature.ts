import { createHmac } from 'node:crypto';

/** HMAC-SHA256 (hex) of the exact query string, keyed with the API secret, as Binance expects for SIGNED endpoints. */
export function signQuery(query: string, secret: string): string {
  return createHmac('sha256', secret).update(query).digest('hex');
}
