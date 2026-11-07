import { useAuth } from "@clerk/nextjs";
import createClient, { type Client, type Middleware } from "openapi-fetch";
import { useMemo } from "react";
import type { paths } from "./schema";

/**
 * The single `openapi-fetch` client (C7, C8): typed by the generated `schema.d.ts`, base URL
 * `NEXT_PUBLIC_API_BASE_URL`, Clerk Bearer token added by a request middleware. Server code gets it
 * through `getServerApi()` (`server.ts`); client components through `useApiClient()`.
 */

export type ApiClient = Client<paths>;

export interface ApiClientOptions {
  /** Resolves the Clerk session JWT, or `null` when signed out. */
  getToken: () => Promise<string | null | undefined>;
  /** Defaults to `NEXT_PUBLIC_API_BASE_URL`. */
  baseUrl?: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: (request: Request) => Promise<Response>;
}

const PORTAL_PREFIX = "/api/v1/portal";

/** Portal routes are public (`api-contract.md` §5): the token is never sent nor requested. */
export function isPortalPath(pathname: string): boolean {
  return pathname === PORTAL_PREFIX || pathname.startsWith(`${PORTAL_PREFIX}/`);
}

function tokenMiddleware(getToken: ApiClientOptions["getToken"]): Middleware {
  return {
    async onRequest({ request }) {
      if (isPortalPath(new URL(request.url).pathname)) return undefined;
      if (request.headers.has("authorization")) return undefined;
      const token = await getToken();
      if (token) request.headers.set("authorization", `Bearer ${token}`);
      return request;
    },
  };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!baseUrl) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  const client = createClient<paths>({
    baseUrl,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(tokenMiddleware(options.getToken));
  return client;
}

/**
 * Browser/client-component client (comboboxes, search): Clerk `useAuth().getToken()` is read on each
 * request. Clerk keeps `getToken` referentially stable, so the client is stable across renders.
 */
export function useApiClient(options: Pick<ApiClientOptions, "baseUrl" | "fetch"> = {}): ApiClient {
  const { getToken } = useAuth();
  const { baseUrl, fetch } = options;
  return useMemo(
    () =>
      createApiClient({
        getToken: () => getToken(),
        ...(baseUrl ? { baseUrl } : {}),
        ...(fetch ? { fetch } : {}),
      }),
    [getToken, baseUrl, fetch],
  );
}

export interface PortalApiClientOptions {
  /** Defaults to `NEXT_PUBLIC_API_BASE_URL`. */
  baseUrl?: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetch?: (request: Request) => Promise<Response>;
}

function requireBaseUrl(baseUrl: string | undefined): string {
  const resolved = baseUrl ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!resolved) throw new Error("NEXT_PUBLIC_API_BASE_URL is not set");
  return resolved;
}

/** Portal mode (additive, F5): the visitor has no Clerk session, so no `Authorization` header ever leaves. */
const noAuthorization: Middleware = {
  onRequest({ request }) {
    request.headers.delete("authorization");
    return request;
  },
};

/**
 * Client of the public portal `/api/v1/portal/**` (C22): no token middleware, and `credentials: "include"`
 * so the BE's signed unlock cookie travels cross-origin (the BE CORS allows the FE origin with credentials).
 */
export function createPortalApiClient(options: PortalApiClientOptions = {}): ApiClient {
  const client = createClient<paths>({
    baseUrl: requireBaseUrl(options.baseUrl),
    credentials: "include",
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  client.use(noAuthorization);
  return client;
}

/** Portal client for client components; it never reads the Clerk session. */
export function usePortalApiClient(options: PortalApiClientOptions = {}): ApiClient {
  const { baseUrl, fetch } = options;
  return useMemo(
    () =>
      createPortalApiClient({
        ...(baseUrl ? { baseUrl } : {}),
        ...(fetch ? { fetch } : {}),
      }),
    [baseUrl, fetch],
  );
}

/**
 * Link to `GET /api/v1/portal/{token}/files/{documentId}` on the API origin: the browser follows it with the
 * BE cookie (the BE answers a 302 to a signed URL). `attachment` is logged by the BE as a `DOWNLOAD`.
 */
export function portalFileUrl(
  token: string,
  documentId: string,
  disposition: "inline" | "attachment",
): string {
  const base = requireBaseUrl(undefined).replace(/\/+$/, "");
  return `${base}${PORTAL_PREFIX}/${encodeURIComponent(token)}/files/${encodeURIComponent(documentId)}?disposition=${disposition}`;
}
