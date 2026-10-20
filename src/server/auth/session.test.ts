import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSession = vi.hoisted(() => ({ getMockSessionUser: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/mocks/session", () => mockSession);

import { UnauthenticatedError, getSessionUser, requireSessionUser } from "./session";
import type { SessionUser } from "./types";

const owner: SessionUser = {
  id: "usr_1",
  name: "Test Owner",
  email: "owner@example.com",
  imageUrl: null,
  role: "OWNER",
  locale: "es",
  theme: "system",
};

beforeEach(() => {
  mockSession.getMockSessionUser.mockReset();
});

describe("getSessionUser (Hito 1: delegates to the mock session)", () => {
  it("returns what the mock session resolves", async () => {
    mockSession.getMockSessionUser.mockResolvedValue(owner);
    expect(await getSessionUser()).toBe(owner);
    expect(mockSession.getMockSessionUser).toHaveBeenCalledTimes(1);
  });

  it("returns null when nobody is signed in", async () => {
    mockSession.getMockSessionUser.mockResolvedValue(null);
    expect(await getSessionUser()).toBeNull();
  });
});

describe("requireSessionUser", () => {
  it("returns the user", async () => {
    mockSession.getMockSessionUser.mockResolvedValue(owner);
    expect(await requireSessionUser()).toBe(owner);
  });

  it("throws UnauthenticatedError (code UNAUTHENTICATED) without a user", async () => {
    mockSession.getMockSessionUser.mockResolvedValue(null);
    const error = await requireSessionUser().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnauthenticatedError);
    expect((error as UnauthenticatedError).code).toBe("UNAUTHENTICATED");
  });
});
