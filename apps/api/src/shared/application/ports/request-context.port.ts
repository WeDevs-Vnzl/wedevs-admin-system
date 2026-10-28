/** Per-request metadata recorded on `USER` activity entries (PRD §8.14). */
export interface RequestMetadata {
  readonly ip: string | null;
  readonly userAgent: string | null;
}

/** Carries the request metadata through the async call chain without changing any use-case signature. */
export interface RequestContextPort {
  /** The metadata of the request being handled, or `null` outside a request (jobs, scripts). */
  current(): RequestMetadata | null;
  /** Runs `fn` (and everything it awaits) with `meta` as the current metadata. */
  run<T>(meta: RequestMetadata, fn: () => T): T;
}
