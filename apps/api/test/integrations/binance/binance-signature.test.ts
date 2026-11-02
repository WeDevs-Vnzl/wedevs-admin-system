import { describe, expect, it } from 'vitest';
import { signQuery } from '../../../src/modules/integrations/infrastructure/binance/binance-signature';

describe('Binance request signature', () => {
  it('matches the vector published in the Binance API documentation', () => {
    const secret = 'NhqPtmdSJYdKjVHjA7PZj4Mge3R5YNiP1e3UZjInClVN65XAbvqqM6A7H5fATj0j';
    const query =
      'symbol=LTCBTC&side=BUY&type=LIMIT&timeInForce=GTC&quantity=1&price=0.1&recvWindow=5000&timestamp=1499827319559';
    expect(signQuery(query, secret)).toBe(
      'c8db56825ae71d6d79447849e617115f4a920fa2acdcab2b053c4b2838bd6b71',
    );
  });

  it('signs a fixed query with a fixed key (HMAC-SHA256, hex)', () => {
    expect(signQuery('recvWindow=5000&timestamp=1793620800000', 'test-secret')).toBe(
      'e5c949705479b124dfd4756de8709c7ba65e6eaef4b0ba978dd191a7b7413c2d',
    );
  });

  it('changes when the secret or any byte of the query changes', () => {
    const base = signQuery('timestamp=1', 'k1');
    expect(signQuery('timestamp=1', 'k2')).not.toBe(base);
    expect(signQuery('timestamp=2', 'k1')).not.toBe(base);
  });
});
