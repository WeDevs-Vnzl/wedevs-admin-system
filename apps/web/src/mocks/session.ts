// MOCK — Hito 1 mock bridge. The signed-in user is the BE session user (`GET /api/v1/me`, FE-INT-0 0.4);
// the "View as role" cookie still overrides its role for the mock service context only, so unintegrated
// modules keep their role demos. Deleted with `src/mocks/` at the close of the FE integration (C9).
import { cookies } from "next/headers";
import { userRoleSchema, type UserRole } from "@/lib/validators/enums";
import type { SessionUser } from "@/server/auth/types";

/** MOCK-only "View as role" override (DT-40). Holds a `UserRole` value; anything else is ignored. */
export const MOCK_ROLE_COOKIE = "wd_mock_role";

/** Two fictional partners (Owners), as in the wireframes. Fixtures only: they are not the signed-in user. */
const ANDRES_MOLINA: SessionUser = {
  id: "usr_andres_molina",
  name: "Andrés Molina",
  email: "andres.molina@example.com",
  imageUrl: null,
  role: "OWNER",
  locale: "es",
  theme: "system",
};

export const MOCK_USERS: readonly SessionUser[] = [
  ANDRES_MOLINA,
  {
    id: "usr_valeria_rojas",
    name: "Valeria Rojas",
    email: "valeria.rojas@example.com",
    imageUrl: null,
    role: "OWNER",
    locale: "es",
    theme: "system",
  },
];

/** A fixture Owner (the first of `MOCK_USERS`). Not the signed-in user since FE-INT-0 0.4. */
export const MOCK_DEFAULT_USER: SessionUser = ANDRES_MOLINA;

/** Validates the raw cookie value; `null` when absent or not a real role. */
export function parseMockRole(value: string | null | undefined): UserRole | null {
  const parsed = userRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Returns the user with the role replaced by a valid override; any other value returns the user as is. */
export function applyMockRoleOverride(
  user: SessionUser,
  roleOverride: string | null | undefined,
): SessionUser {
  const role = parseMockRole(roleOverride);
  return role ? { ...user, role } : user;
}

/**
 * The signed-in user for the mock service context: the BE session user (`null` when signed out; a Clerk
 * session without a local user redirects to the no-access state) with the
 * "View as role" cookie applied. The BE role stays the source of truth everywhere else (C13).
 */
export async function getMockSessionUser(): Promise<SessionUser | null> {
  // Imported lazily: this module is also loaded by fixture code and tests, which must not pull the
  // server-only BE session at load time.
  const { getSessionUserOrRedirect } = await import("@/server/auth/session");
  const user = await getSessionUserOrRedirect();
  if (!user) return null;
  const store = await cookies();
  return applyMockRoleOverride(user, store.get(MOCK_ROLE_COOKIE)?.value);
}
