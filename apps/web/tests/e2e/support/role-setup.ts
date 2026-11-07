import { chromium, request, type APIRequestContext, type Page } from "@playwright/test";
import { signInAs } from "./auth";
import { apiBaseUrl } from "./backend";
import { ROLE_EMAIL_ENV, roleEmail, type TestRole } from "./roles";

// FE-INT-R E.0. The BE takes a role only from the `user.created` metadata and never changes it on `user.updated`
// (C13), so the Admin, Member and Viewer test users get their role here, as the Owner, through
// `PATCH /api/v1/users/{id}`. The setup is idempotent: a user that already has its role is not patched.
// Only the e-mails in the `E2E_*_EMAIL` variables are read, and no value is logged; errors name the variable only.

const ROLES_TO_SYNC = ["ADMIN", "MEMBER", "VIEWER"] as const satisfies readonly TestRole[];
const SESSION_TOKEN_ATTEMPTS = 20;
const SESSION_TOKEN_WAIT_MS = 500;
const API_TIMEOUT_MS = 15_000;

interface ClerkGlobal {
  Clerk?: { session?: { getToken: () => Promise<string | null> } | null };
}

interface UserListBody {
  items: { id: string; email: string; role: string }[];
}

/** Signs in as the Owner in a throwaway browser context, then sets the other test roles through the BE API. */
export async function syncTestRoles(appUrl: string): Promise<void> {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: appUrl });
    const page = await context.newPage();
    await signInAs(page, "OWNER");
    const token = await readSessionToken(page);
    await context.close();

    const api = await request.newContext({
      baseURL: apiBaseUrl(),
      timeout: API_TIMEOUT_MS,
      extraHTTPHeaders: { Authorization: `Bearer ${token}` },
    });
    try {
      for (const role of ROLES_TO_SYNC) {
        await syncUserRole(api, role);
      }
    } finally {
      await api.dispose();
    }
  } finally {
    await browser.close();
  }
}

/** Reads the Owner's Clerk session token from the page; Clerk loads it a moment after the sign-in. */
async function readSessionToken(page: Page): Promise<string> {
  for (let attempt = 0; attempt < SESSION_TOKEN_ATTEMPTS; attempt += 1) {
    const token = await page.evaluate(async () => {
      const clerk = (window as unknown as ClerkGlobal).Clerk;
      return (await clerk?.session?.getToken()) ?? null;
    });
    if (token) return token;
    await page.waitForTimeout(SESSION_TOKEN_WAIT_MS);
  }
  throw new Error("The Owner session token is not available from Clerk (E2E role setup, DT-204)");
}

async function syncUserRole(api: APIRequestContext, role: TestRole): Promise<void> {
  const envName = ROLE_EMAIL_ENV[role];
  const email = roleEmail(role).toLowerCase();
  const list = await api.get("/api/v1/users", { params: { q: email } });
  if (!list.ok()) {
    throw new Error(`Listing users failed with HTTP ${list.status()} (E2E role setup for ${envName})`);
  }
  const body = (await list.json()) as UserListBody;
  const user = body.items.find((item) => item.email.toLowerCase() === email);
  if (!user) {
    throw new Error(`No local user row for the e-mail in ${envName}; sign the test user in once (support/backend.ts)`);
  }
  if (user.role === role) return;
  const patch = await api.patch(`/api/v1/users/${encodeURIComponent(user.id)}`, { data: { role } });
  if (!patch.ok()) {
    throw new Error(`Changing the role for ${envName} failed with HTTP ${patch.status()} (E2E role setup)`);
  }
}
