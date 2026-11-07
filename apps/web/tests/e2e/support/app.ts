/** Default origin of the FE under test. Agents and the Tester run it on localhost; CI and the user set the variables. */
export const LOCAL_APP_BASE_URL = "http://localhost:3000";

/** The FE origin the E2E run targets: `PLAYWRIGHT_BASE_URL`, then `APP_URL`, then the local default. */
export function appBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.PLAYWRIGHT_BASE_URL ?? env.APP_URL ?? LOCAL_APP_BASE_URL;
}
