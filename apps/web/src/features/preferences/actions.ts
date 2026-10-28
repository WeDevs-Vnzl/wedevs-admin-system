"use server";

import { resetPreferenceInputSchema, setPreferenceInputSchema } from "@/lib/validators/preferences";
import * as preferences from "@/mocks/services/preferences";
import { defineAction } from "@/server/actions/define-action";

// A user's own preferences: any signed-in role may change them (no row of the PRD §4.3 matrix applies).
// Column layouts are client state the table already holds, so only locale, theme and zone refresh the app.
export const setPreferenceAction = defineAction({
  permission: "authenticated",
  input: setPreferenceInputSchema,
  revalidate: (data) => (data.key.startsWith("table:") ? [] : [{ path: "/", type: "layout" }]),
  handler: (ctx, data) => preferences.setPreference(ctx, data),
});

export const resetPreferenceAction = defineAction({
  permission: "authenticated",
  input: resetPreferenceInputSchema,
  revalidate: (data) => (data.key.startsWith("table:") ? [] : [{ path: "/", type: "layout" }]),
  handler: (ctx, data) => preferences.resetPreference(ctx, data),
});
