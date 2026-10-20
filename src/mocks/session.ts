// MOCK — Hito 1 session. Replaced by Clerk + the local `User` table in Hito 2 (H2-B2); this file is
// deleted with `src/mocks/` at the close of Hito 2 (C9).
import { cookies } from "next/headers";
import { userRoleSchema, type UserRole } from "@/lib/validators/enums";
import type { SessionUser } from "@/server/auth/types";

/** MOCK-only "View as role" override (DT-40). Holds a `UserRole` value; anything else is ignored. */
export const MOCK_ROLE_COOKIE = "wd_mock_role";

/** Two fictional partners (Owners), as in the wireframes. No real people or real addresses (C5). */
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

/** The user that is "signed in" by default in Hito 1. */
export const MOCK_DEFAULT_USER: SessionUser = ANDRES_MOLINA;

/** Validates the raw cookie value; `null` when absent or not a real role. */
export function parseMockRole(value: string | null | undefined): UserRole | null {
  const parsed = userRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Builds the mock session user: the default Owner, with the role replaced by a valid override. */
export function resolveMockSessionUser(roleOverride?: string | null): SessionUser {
  const role = parseMockRole(roleOverride);
  return role ? { ...MOCK_DEFAULT_USER, role } : { ...MOCK_DEFAULT_USER };
}

/** Reads the `wd_mock_role` cookie of the current request and returns the mock session user. */
export async function getMockSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  return resolveMockSessionUser(store.get(MOCK_ROLE_COOKIE)?.value);
}
