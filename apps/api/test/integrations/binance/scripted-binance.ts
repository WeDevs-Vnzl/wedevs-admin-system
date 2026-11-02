/** Scripted `fetch` for the Binance adapter tests: records every request, answers from a handler, opens no socket. */
export interface RecordedRequest {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
}

export type ScriptedHandler = (request: RecordedRequest) => Response | Promise<Response>;

export function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function scriptedFetch(handler: ScriptedHandler): {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const scripted = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: RecordedRequest = {
      url: new URL(typeof input === 'string' || input instanceof URL ? input : input.url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
    };
    requests.push(request);
    return handler(request);
  }) as typeof fetch;
  return { fetch: scripted, requests };
}

export interface ScriptedDeposit {
  readonly id: string;
  readonly coin: string;
  readonly amount: string;
  readonly insertTime: number;
  readonly status: number;
  readonly txId: string;
}

/** Binance-like account: `/api/v3/account` and a paginated, windowed `/sapi/v1/capital/deposit/hisrec`. */
export function scriptedAccount(
  balances: { asset: string; free: string; locked: string }[],
  deposits: ScriptedDeposit[],
): ScriptedHandler {
  return ({ url }) => {
    if (url.pathname === '/api/v3/account') return jsonResponse({ balances });
    if (url.pathname === '/sapi/v1/capital/deposit/hisrec') {
      const start = Number(url.searchParams.get('startTime'));
      const end = Number(url.searchParams.get('endTime'));
      const offset = Number(url.searchParams.get('offset') ?? '0');
      const limit = Number(url.searchParams.get('limit') ?? '1000');
      const inWindow = deposits
        .filter((row) => row.insertTime >= start && row.insertTime <= end)
        .sort((a, b) => b.insertTime - a.insertTime); // Binance answers newest first
      return jsonResponse(inWindow.slice(offset, offset + limit));
    }
    return jsonResponse({ code: -1, msg: 'unexpected path' }, 404);
  };
}
