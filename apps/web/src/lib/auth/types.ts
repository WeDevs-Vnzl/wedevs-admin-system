import type { UserRole } from "@/lib/validators/enums";

/** UI language of a user. The i18n config (`src/i18n/config.ts`) owns the runtime list; this is the shape. */
export type SessionLocale = "es" | "en";

/** Theme preference of a user (`next-themes`: light, dark or follow the system). */
export type SessionTheme = "light" | "dark" | "system";

/**
 * The authenticated user as the application sees it, built from `GET /api/v1/me` (FE-INT-0 0.4): the BE's
 * local `User` row (the DB role is the source of truth, never Clerk metadata — C13).
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  imageUrl: string | null;
  role: UserRole;
  locale: SessionLocale;
  theme: SessionTheme;
}

/**
 * Identity part of the service context (`ctx = { db, user, now }`, C11): what an action or service needs
 * to know about who is acting. `server/context.ts` composes it with the data source and the clock.
 */
export interface AuthContext {
  user: SessionUser;
}
