import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  userId: null as string | null,
  get: vi.fn(),
}));
vi.mock("server-only", () => ({}));
// `getRequestConfig(fn)` returns the callback itself, so the test can call the request config directly.
vi.mock("next-intl/server", () => ({ getRequestConfig: (fn: unknown) => fn }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "NEXT_LOCALE" && mocks.cookieValue ? { value: mocks.cookieValue } : undefined,
  }),
}));
vi.mock("@/lib/auth/session", () => ({
  getSessionUser: async () => (mocks.userId ? { id: mocks.userId } : null),
}));
vi.mock("@/lib/api/server", () => ({ getServerApi: async () => ({ GET: mocks.get }) }));

import requestConfig from "./request";

const resolve = () => (requestConfig as unknown as () => Promise<{ locale: string }>)();

const stored = (locale: string) =>
  mocks.get.mockResolvedValue({ data: { locale, theme: "dark" }, response: new Response() });

beforeEach(() => {
  mocks.cookieValue = undefined;
  mocks.userId = null;
  mocks.get.mockReset();
});

describe("i18n request config: locale order (HU-30)", () => {
  it("falls back to the stored UserPreference locale when NEXT_LOCALE is absent", async () => {
    mocks.userId = "user_1";
    stored("en");
    expect((await resolve()).locale).toBe("en");
    expect(mocks.get).toHaveBeenCalledWith("/api/v1/me/preferences");
  });

  it("the cookie wins when present, with no BE call", async () => {
    mocks.userId = "user_1";
    mocks.cookieValue = "es";
    stored("en");
    expect((await resolve()).locale).toBe("es");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("signed out: the default locale and no BE call", async () => {
    stored("en");
    expect((await resolve()).locale).toBe("es");
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it("an unreadable or unknown stored preference keeps the default locale", async () => {
    mocks.userId = "user_1";
    mocks.get.mockRejectedValue(new Error("network"));
    expect((await resolve()).locale).toBe("es");
    stored("fr");
    expect((await resolve()).locale).toBe("es");
  });
});
