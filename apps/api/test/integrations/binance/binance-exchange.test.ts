import net from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BinanceExchange } from '../../../src/modules/integrations/infrastructure/binance/binance-exchange';
import { BinanceExchangeError } from '../../../src/modules/integrations/infrastructure/binance/binance-errors';
import { signQuery } from '../../../src/modules/integrations/infrastructure/binance/binance-signature';
import { exchangeContract } from '../contracts/exchange.contract';
import { FixedClock } from '../../support/fakes/fixed-clock';
import {
  jsonResponse,
  scriptedAccount,
  scriptedFetch,
  type ScriptedDeposit,
  type ScriptedHandler,
} from './scripted-binance';

const API_KEY = 'test-api-key';
const API_SECRET = 'test-secret';
const NOW = '2026-11-03T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

const BALANCES = [
  { asset: 'USDT', free: '1250.50000000', locked: '0.00000000' },
  { asset: 'BTC', free: '0.00120000', locked: '0.00010000' },
];

function deposit(id: string, iso: string, extra: Partial<ScriptedDeposit> = {}): ScriptedDeposit {
  return {
    id,
    coin: 'USDT',
    amount: '100.00000000',
    insertTime: Date.parse(iso),
    status: 1,
    txId: `tx-${id}`,
    ...extra,
  };
}

function build(handler: ScriptedHandler) {
  const script = scriptedFetch(handler);
  const exchange = new BinanceExchange({
    apiKey: API_KEY,
    apiSecret: API_SECRET,
    baseUrl: 'https://binance.test',
    fetch: script.fetch,
    clock: new FixedClock(NOW),
  });
  return { exchange, requests: script.requests };
}

const CONTRACT_DEPOSITS = [
  deposit('d2', '2026-11-02T12:00:00Z', { txId: '' }),
  deposit('d1', '2026-11-01T12:00:00Z', { amount: '50.25000000' }),
  deposit('d0', '2026-10-01T12:00:00Z', { coin: 'BTC', amount: '0.00100000' }),
];

exchangeContract('Binance (scripted fetch)', () => ({
  port: build(scriptedAccount(BALANCES, CONTRACT_DEPOSITS)).exchange,
  cutoff: new Date('2026-11-01T12:00:00Z'),
  depositsBeforeCutoff: 1,
  depositsFromCutoff: 2,
}));

describe('BinanceExchange requests', () => {
  it('signs balances with the key header, a timestamp from the clock and the signature last', async () => {
    const { exchange, requests } = build(scriptedAccount(BALANCES, []));
    await exchange.balances();

    expect(requests).toHaveLength(1);
    const request = requests[0];
    if (!request) throw new Error('no request recorded');
    expect(request.method).toBe('GET');
    expect(request.url.origin + request.url.pathname).toBe('https://binance.test/api/v3/account');
    expect(request.headers['x-mbx-apikey']).toBe(API_KEY);
    const search = request.url.search.slice(1);
    const unsigned = search.slice(0, search.lastIndexOf('&signature='));
    expect(unsigned).toBe(`recvWindow=5000&timestamp=${NOW_MS}`);
    expect(search).toBe(`${unsigned}&signature=${signQuery(unsigned, API_SECRET)}`);
    expect(search).not.toContain(API_SECRET);
  });

  it('asks for deposits in windows of at most 90 days starting at `since`, signed', async () => {
    const since = new Date(NOW_MS - 200 * 86_400_000);
    const { exchange, requests } = build(scriptedAccount([], []));
    await exchange.deposits(since);

    expect(requests.map((r) => r.url.pathname)).toEqual(
      Array(3).fill('/sapi/v1/capital/deposit/hisrec'),
    );
    const windows = requests.map((r) => [
      Number(r.url.searchParams.get('startTime')),
      Number(r.url.searchParams.get('endTime')),
    ]);
    expect(windows[0]?.[0]).toBe(since.getTime());
    for (const [start, end] of windows)
      expect((end ?? 0) - (start ?? 0)).toBeLessThanOrEqual(90 * 86_400_000);
    expect(windows.at(-1)?.[1]).toBe(NOW_MS);
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]?.[0]).toBeGreaterThan(windows[i - 1]?.[1] ?? 0);
    }
    for (const r of requests) {
      const search = r.url.search.slice(1);
      const unsigned = search.slice(0, search.lastIndexOf('&signature='));
      expect(search.endsWith(`&signature=${signQuery(unsigned, API_SECRET)}`)).toBe(true);
    }
  });

  it('pages through a full window and keeps only credited deposits, amounts as strings', async () => {
    const many = Array.from({ length: 1001 }, (_, i) =>
      deposit(`p${i}`, new Date(NOW_MS - (i + 1) * 60_000).toISOString()),
    );
    many.push(deposit('pending', '2026-11-03T11:00:00Z', { status: 0 }));
    many.push(deposit('wrong', '2026-11-03T10:00:00Z', { status: 7 }));
    many.push(deposit('credited', '2026-11-03T09:00:00Z', { status: 6, amount: '0.1' }));
    const { exchange, requests } = build(scriptedAccount([], many));

    const rows = await exchange.deposits(new Date(NOW_MS - 86_400_000));
    expect(requests.length).toBeGreaterThan(1);
    expect(rows.map((r) => r.id)).not.toContain('pending');
    expect(rows.map((r) => r.id)).not.toContain('wrong');
    expect(rows.find((r) => r.id === 'credited')?.amount).toBe('0.1');
    expect(rows).toHaveLength(1002);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(typeof rows[0]?.amount).toBe('string');
  });

  it('maps an empty txId to null', async () => {
    const { exchange } = build(
      scriptedAccount([], [deposit('d', '2026-11-03T00:00:00Z', { txId: '' })]),
    );
    const [row] = await exchange.deposits(new Date('2026-11-02T00:00:00Z'));
    expect(row?.txId).toBeNull();
    expect(row?.insertedAt).toEqual(new Date('2026-11-03T00:00:00Z'));
  });

  it('only reads: GET on the account and deposit paths, never a price or a trading call (DT-185)', async () => {
    const { exchange, requests } = build(scriptedAccount(BALANCES, CONTRACT_DEPOSITS));
    await exchange.balances();
    await exchange.deposits(new Date('2026-10-01T00:00:00Z'));
    expect(new Set(requests.map((r) => r.method))).toEqual(new Set(['GET']));
    expect(new Set(requests.map((r) => r.url.pathname))).toEqual(
      new Set(['/api/v3/account', '/sapi/v1/capital/deposit/hisrec']),
    );
  });
});

describe('BinanceExchange failures', () => {
  async function failure(response: Response | Error) {
    const { exchange, requests } = build(() => {
      if (response instanceof Error) throw response;
      return response;
    });
    const error = await exchange.balances().then(
      () => null,
      (e: unknown) => e,
    );
    return { error, requests };
  }

  it.each([429, 418])(
    'turns HTTP %i into RATE_LIMITED with Retry-After, without retrying',
    async (status) => {
      const { error, requests } = await failure(
        jsonResponse({ code: -1003, msg: 'Too many requests' }, status, { 'retry-after': '30' }),
      );
      expect(error).toBeInstanceOf(BinanceExchangeError);
      expect(error).toMatchObject({
        code: 'RATE_LIMITED',
        reason: 'RATE_LIMITED',
        retryAfterSeconds: 30,
      });
      expect(requests).toHaveLength(1);
    },
  );

  it('keeps retryAfterSeconds null when the header is absent or not a number', async () => {
    const { error } = await failure(jsonResponse({}, 429, { 'retry-after': 'soon' }));
    expect(error).toMatchObject({ reason: 'RATE_LIMITED', retryAfterSeconds: null });
  });

  it.each([500, 502, 503, 504])(
    'turns HTTP %i into UNAVAILABLE, without retrying',
    async (status) => {
      const { error, requests } = await failure(jsonResponse({ code: -1000, msg: 'boom' }, status));
      expect(error).toMatchObject({ code: 'INTERNAL', reason: 'UNAVAILABLE', status });
      expect(requests).toHaveLength(1);
    },
  );

  it.each([400, 401, 403])(
    'turns HTTP %i into REJECTED carrying the Binance code',
    async (status) => {
      const { error } = await failure(
        jsonResponse({ code: -2015, msg: 'Invalid API-key' }, status),
      );
      expect(error).toMatchObject({
        code: 'INTERNAL',
        reason: 'REJECTED',
        status,
        providerCode: -2015,
      });
    },
  );

  it('turns a transport error into UNAVAILABLE without leaking its text', async () => {
    const { error } = await failure(new TypeError(`fetch failed ${API_SECRET}`));
    expect(error).toMatchObject({ reason: 'UNAVAILABLE', status: null });
    expect(String((error as Error).message)).not.toContain(API_SECRET);
  });

  it.each([
    ['a non-JSON body', new Response('<html>', { status: 200 })],
    ['a body without balances', jsonResponse({})],
    [
      'a balance with a non-decimal amount',
      jsonResponse({ balances: [{ asset: 'A', free: 'x', locked: '0' }] }),
    ],
    ['a numeric amount', jsonResponse({ balances: [{ asset: 'A', free: 1.5, locked: '0' }] })],
  ])('turns %s into MALFORMED', async (_name, response) => {
    const { error } = await failure(response);
    expect(error).toMatchObject({ reason: 'MALFORMED' });
  });

  it('turns a malformed deposit row into MALFORMED', async () => {
    const { exchange } = build(() =>
      jsonResponse([{ id: 'x', coin: 'USDT', amount: 'abc', insertTime: 1, status: 1 }]),
    );
    await expect(exchange.deposits(new Date(NOW_MS - 1000))).rejects.toMatchObject({
      reason: 'MALFORMED',
    });
  });

  it('does not share error text with the response body', async () => {
    const { error } = await failure(jsonResponse({ code: -1, msg: 'internal detail' }, 500));
    expect((error as Error).message).not.toContain('internal detail');
  });
});

describe('BinanceExchange opens no socket', () => {
  afterEach(() => vi.restoreAllMocks());

  it('never touches the global fetch or a socket when given a scripted fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch');
    const connect = vi.spyOn(net.Socket.prototype, 'connect');
    const { exchange } = build(scriptedAccount(BALANCES, CONTRACT_DEPOSITS));
    await exchange.balances();
    await exchange.deposits(new Date(0));
    expect(globalFetch).not.toHaveBeenCalled();
    expect(connect).not.toHaveBeenCalled();
  });
});
