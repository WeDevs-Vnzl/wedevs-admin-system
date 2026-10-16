import { describe, expect, it } from "vitest";
import {
  UNLOCK_COOKIE_MAX_AGE_SECONDS,
  signUnlockCookie,
  unlockCookieOptions,
  verifyUnlockCookie,
} from "./unlock-cookie";

const SECRET = "test-secret-of-at-least-32-characters!!";
const TOKEN = "A".repeat(43);
const OTHER_TOKEN = "B".repeat(43);
const NOW = new Date("2026-10-09T15:00:00.000Z");

describe("unlock cookie (C22)", () => {
  it("round-trips the unlocked ids of its own token", () => {
    const value = signUnlockCookie(
      { token: TOKEN, documentIds: ["doc_1", "doc_2"], now: NOW },
      SECRET,
    );
    expect(verifyUnlockCookie(value, TOKEN, NOW, SECRET)).toEqual(["doc_1", "doc_2"]);
  });

  it("never carries the token or a key in clear", () => {
    const value = signUnlockCookie({ token: TOKEN, documentIds: ["doc_1"], now: NOW }, SECRET);
    expect(value).not.toContain(TOKEN);
  });

  it("is worth nothing for another link", () => {
    const value = signUnlockCookie({ token: TOKEN, documentIds: ["doc_1"], now: NOW }, SECRET);
    expect(verifyUnlockCookie(value, OTHER_TOKEN, NOW, SECRET)).toEqual([]);
  });

  it("is worth nothing once tampered with or signed with another secret", () => {
    const value = signUnlockCookie({ token: TOKEN, documentIds: ["doc_1"], now: NOW }, SECRET);
    const [payload, signature] = value.split(".") as [string, string];
    const forged = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(payload, "base64url").toString()),
        ids: ["doc_1", "doc_9"],
      }),
    ).toString("base64url");
    expect(verifyUnlockCookie(`${forged}.${signature}`, TOKEN, NOW, SECRET)).toEqual([]);
    expect(verifyUnlockCookie(value, TOKEN, NOW, `${SECRET}-other`)).toEqual([]);
    expect(verifyUnlockCookie("garbage", TOKEN, NOW, SECRET)).toEqual([]);
    expect(verifyUnlockCookie(undefined, TOKEN, NOW, SECRET)).toEqual([]);
  });

  it(`expires ${UNLOCK_COOKIE_MAX_AGE_SECONDS / 3600} h after it was signed`, () => {
    const value = signUnlockCookie({ token: TOKEN, documentIds: ["doc_1"], now: NOW }, SECRET);
    const later = new Date(NOW.getTime() + UNLOCK_COOKIE_MAX_AGE_SECONDS * 1000 + 1);
    expect(verifyUnlockCookie(value, TOKEN, later, SECRET)).toEqual([]);
  });

  it("is httpOnly, Secure, SameSite=Strict and scoped to the token paths", () => {
    expect(unlockCookieOptions(TOKEN, "page")).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "strict",
      path: `/s/${TOKEN}`,
      maxAge: UNLOCK_COOKIE_MAX_AGE_SECONDS,
    });
    expect(unlockCookieOptions(TOKEN, "api").path).toBe(`/api/s/${TOKEN}`);
  });
});
