import type { ErrorCode } from "@/lib/validators/common";
import { createApiClient, type ApiClient } from "./client";

/**
 * HTTP test double for FE tests: a real `openapi-fetch` client (with the real token middleware) whose
 * `fetch` is a route table, so tests exercise the API-calling code with no network and no mocked domain
 * layer (DT-89). Test-only: production code never imports this file.
 */

export type RouteResponse =
  Response | { status?: number; body?: unknown; headers?: Record<string, string> };

export type RouteHandler =
  RouteResponse | ((call: RecordedCall) => RouteResponse | Promise<RouteResponse>);

/** Keys are `"METHOD /path"`; `{param}` segments match any single path segment. */
export type RouteTable = Record<string, RouteHandler>;

export interface RecordedCall {
  method: string;
  /** Pathname, e.g. `/api/v1/clients/c1`. */
  path: string;
  search: URLSearchParams;
  headers: Headers;
  /** Parsed JSON body, or `undefined` when there is none. */
  body: unknown;
}

/** HTTP status the BE uses for each error code (`api-contract.md` §4). */
export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  VALIDATION: 422,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTEGRITY_LOCK: 409,
  ACCESS_KEY_INVALID: 401,
  ACCESS_KEY_LOCKED: 429,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export interface ErrorEnvelopeInit {
  message?: string;
  fieldErrors?: Record<string, string[]> | null;
  entity?: { type: string; id: string; code: string | null; label: string } | null;
  correlationId?: string;
}

/** A route response carrying the standard error envelope for `code`. */
export function errorEnvelope(
  code: ErrorCode,
  init: ErrorEnvelopeInit = {},
): { status: number; body: unknown } {
  return {
    status: ERROR_HTTP_STATUS[code],
    body: {
      error: {
        code,
        message: init.message ?? `common.errors.${code}`,
        fieldErrors: init.fieldErrors ?? null,
        entity: init.entity ?? null,
        correlationId: init.correlationId ?? "test-correlation-id",
      },
    },
  };
}

export interface MockApi {
  api: ApiClient;
  /** Every request the client made, in order. */
  calls: RecordedCall[];
  /** The `fetch` the client uses (also usable with `createApiClient`). */
  fetch: (request: Request) => Promise<Response>;
}

export interface MockApiOptions {
  /** Token the middleware attaches; `null` simulates a signed-out caller. Default `"test-token"`. */
  token?: string | null;
}

const BASE_URL = "http://api.test";

function matches(pattern: string, path: string): boolean {
  const a = pattern.split("/");
  const b = path.split("/");
  return (
    a.length === b.length &&
    a.every((seg, i) => (seg.startsWith("{") && seg.endsWith("}") ? Boolean(b[i]) : seg === b[i]))
  );
}

function toResponse(value: RouteResponse): Response {
  if (value instanceof Response) return value;
  const status = value.status ?? 200;
  const noBody = status === 204 || value.body === undefined;
  return new Response(noBody ? null : JSON.stringify(value.body), {
    status,
    headers: { ...(noBody ? {} : { "content-type": "application/json" }), ...value.headers },
  });
}

export function mockApi(routes: RouteTable, options: MockApiOptions = {}): MockApi {
  const calls: RecordedCall[] = [];
  const token = options.token === undefined ? "test-token" : options.token;

  const fetchImpl = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const text = await request.clone().text();
    const call: RecordedCall = {
      method: request.method,
      path: url.pathname,
      search: url.searchParams,
      headers: request.headers,
      body: text ? JSON.parse(text) : undefined,
    };
    calls.push(call);

    for (const [key, handler] of Object.entries(routes)) {
      const [method, pattern] = key.split(" ");
      if (method?.toUpperCase() !== call.method || !pattern || !matches(pattern, call.path))
        continue;
      return toResponse(typeof handler === "function" ? await handler(call) : handler);
    }
    throw new TypeError(`mockApi: no route for ${call.method} ${call.path}`);
  };

  return {
    api: createApiClient({ baseUrl: BASE_URL, getToken: async () => token, fetch: fetchImpl }),
    calls,
    fetch: fetchImpl,
  };
}
