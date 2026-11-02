import type {
  ExchangeBalance,
  ExchangeDeposit,
  ExchangePort,
} from '../../application/ports/exchange.port';
import type { ClockPort } from '../../../../shared/application/ports/clock.port';
import { BinanceExchangeError } from './binance-errors';
import { signQuery } from './binance-signature';

export interface BinanceExchangeOptions {
  readonly apiKey: string;
  readonly apiSecret: string;
  /** `https://api.binance.com` in production; a scripted host in tests. */
  readonly baseUrl: string;
  /** Injected so no test opens a socket; production passes the platform `fetch`. */
  readonly fetch: typeof fetch;
  readonly clock: ClockPort;
  readonly recvWindowMs?: number;
  readonly requestTimeoutMs?: number;
}

const DAY_MS = 86_400_000;
/** Binance rejects a deposit-history range wider than 90 days. */
const DEPOSIT_WINDOW_MS = 90 * DAY_MS;
const DEPOSIT_PAGE_SIZE = 1000;
/** Deposit statuses that mean the funds are credited: 1 success, 6 credited but not yet withdrawable. */
const CREDITED_STATUSES = new Set([1, 6]);
const DECIMAL = /^\d+(\.\d+)?$/;

type Json = Record<string, unknown>;

/**
 * Read-only `ExchangePort` over Binance spot (DT-184): wallet balances and deposit history through HMAC-SHA256
 * signed GETs. Amounts stay as the strings Binance sends (C15). No retries (the job retries) and no price call
 * (DT-185).
 */
export class BinanceExchange implements ExchangePort {
  constructor(private readonly options: BinanceExchangeOptions) {}

  async balances(): Promise<ExchangeBalance[]> {
    const body = await this.signedGet('/api/v3/account', {});
    const rows = isObject(body) ? body.balances : undefined;
    if (!Array.isArray(rows)) throw malformed();
    return rows.map((row: unknown) => {
      if (!isObject(row)) throw malformed();
      const { asset, free, locked } = row;
      if (typeof asset !== 'string' || !isDecimal(free) || !isDecimal(locked)) throw malformed();
      return { asset, free, locked };
    });
  }

  async deposits(since: Date): Promise<ExchangeDeposit[]> {
    const now = this.options.clock.now().getTime();
    const found: ExchangeDeposit[] = [];
    for (let start = since.getTime(); start <= now;) {
      const end = Math.min(start + DEPOSIT_WINDOW_MS, now);
      for (let offset = 0; ; offset += DEPOSIT_PAGE_SIZE) {
        const page = await this.signedGet('/sapi/v1/capital/deposit/hisrec', {
          startTime: String(start),
          endTime: String(end),
          offset: String(offset),
          limit: String(DEPOSIT_PAGE_SIZE),
        });
        if (!Array.isArray(page)) throw malformed();
        for (const row of page) {
          const deposit = toDeposit(row);
          if (deposit) found.push(deposit);
        }
        if (page.length < DEPOSIT_PAGE_SIZE) break;
      }
      start = end + 1;
    }
    return found.sort(
      (a, b) => a.insertedAt.getTime() - b.insertedAt.getTime() || a.id.localeCompare(b.id),
    );
  }

  private async signedGet(path: string, params: Record<string, string>): Promise<unknown> {
    const query = new URLSearchParams({
      ...params,
      recvWindow: String(this.options.recvWindowMs ?? 5000),
      timestamp: String(this.options.clock.now().getTime()),
    }).toString();
    const url = `${this.options.baseUrl}${path}?${query}&signature=${signQuery(query, this.options.apiSecret)}`;

    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method: 'GET',
        headers: { 'X-MBX-APIKEY': this.options.apiKey },
        signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 10_000),
      });
    } catch {
      // The transport error text may echo the URL (signature included): drop it.
      throw new BinanceExchangeError('UNAVAILABLE', null);
    }

    if (response.status === 429 || response.status === 418) {
      throw new BinanceExchangeError(
        'RATE_LIMITED',
        response.status,
        parseRetryAfter(response.headers.get('retry-after')),
      );
    }
    if (response.status >= 500) throw new BinanceExchangeError('UNAVAILABLE', response.status);
    if (!response.ok) {
      throw new BinanceExchangeError(
        'REJECTED',
        response.status,
        null,
        await providerCode(response),
      );
    }
    try {
      return (await response.json()) as unknown;
    } catch {
      throw malformed();
    }
  }
}

function toDeposit(row: unknown): ExchangeDeposit | null {
  if (!isObject(row)) throw malformed();
  const { id, coin, amount, insertTime, status, txId } = row;
  if (
    typeof id !== 'string' ||
    typeof coin !== 'string' ||
    !isDecimal(amount) ||
    typeof insertTime !== 'number' ||
    !Number.isFinite(insertTime) ||
    typeof status !== 'number'
  ) {
    throw malformed();
  }
  if (!CREDITED_STATUSES.has(status)) return null;
  return {
    id,
    asset: coin,
    amount,
    insertedAt: new Date(insertTime),
    txId: typeof txId === 'string' && txId !== '' ? txId : null,
  };
}

function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number(header.trim());
}

async function providerCode(response: Response): Promise<number | null> {
  try {
    const body = (await response.json()) as unknown;
    return isObject(body) && typeof body.code === 'number' ? body.code : null;
  } catch {
    return null;
  }
}

const malformed = (): BinanceExchangeError => new BinanceExchangeError('MALFORMED', null);
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isDecimal = (value: unknown): value is string =>
  typeof value === 'string' && DECIMAL.test(value);
