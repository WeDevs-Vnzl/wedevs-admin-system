"use server";

import { apiAction, type RevalidateTarget } from "@/lib/api/action";
import type { ResetPreferenceInput, SetPreferenceInput } from "@/lib/validators/preferences";

// A user's own preferences: the BE scopes every call to the caller (any signed-in role). Column layouts are
// client state the table already holds, so only locale, theme and zone refresh the app.
const refresh = (input: { key: string }): readonly RevalidateTarget[] =>
  input.key.startsWith("table:") ? [] : [{ path: "/", type: "layout" }];

export const setPreferenceAction = apiAction({
  call: ({ key, value }: SetPreferenceInput, api) =>
    api.PUT("/api/v1/me/preferences/{key}", { params: { path: { key } }, body: { value } }),
  revalidate: refresh,
});

export const resetPreferenceAction = apiAction({
  call: ({ key }: ResetPreferenceInput, api) =>
    api.DELETE("/api/v1/me/preferences/{key}", { params: { path: { key } } }),
  revalidate: refresh,
});
