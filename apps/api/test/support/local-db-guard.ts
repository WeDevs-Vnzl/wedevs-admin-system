const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Query parameters with which `pg` overrides the URL authority host. */
const HOST_OVERRIDES = ['host', 'hostaddr', 'service'];

/**
 * Throws unless the database host is local. Tests that write to a database must call this first
 * (safeguards.md rule 8). Rejects the host overrides `pg` honours in the query string
 * (`?host=`, `?hostaddr=`). The URL is never included in the error message.
 */
export function assertLocalDatabaseUrl(url: string | undefined): string {
  if (!url) throw new Error('DATABASE_URL is not set');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL');
  }
  if (HOST_OVERRIDES.some((key) => parsed.searchParams.has(key))) {
    throw new Error('Refusing to run against a database URL with a host override');
  }
  if (!LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error('Refusing to run against a non-local database host');
  }
  return url;
}
