// Test roles for the authenticated E2E project (DT-204). Each role has one Clerk test user in the Clerk dev
// instance; its e-mail and display name come from the environment variables named here, never from a value in the
// repo. Only the variable NAMES are committed. Error messages name the variable, never its value.

export const TEST_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;

export type TestRole = (typeof TEST_ROLES)[number];

/** Environment variable that holds the Clerk test-user e-mail of each role. */
export const ROLE_EMAIL_ENV: Readonly<Record<TestRole, string>> = {
  OWNER: "E2E_OWNER_EMAIL",
  ADMIN: "E2E_ADMIN_EMAIL",
  MEMBER: "E2E_MEMBER_EMAIL",
  VIEWER: "E2E_VIEWER_EMAIL",
};

/** Environment variable that holds the expected display name of the OWNER user (the user menu check). */
export const OWNER_NAME_ENV = "E2E_OWNER_NAME";

/** Returns the value of an environment variable, or throws naming only the variable. */
export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Environment variable ${name} is not set (E2E authenticated project, DT-204)`);
  }
  return value;
}

/** The Clerk test-user e-mail for a role, read from its environment variable. */
export function roleEmail(role: TestRole, env: NodeJS.ProcessEnv = process.env): string {
  return requireEnv(ROLE_EMAIL_ENV[role], env);
}
