import { afterEach, describe, expect, it, vi } from "vitest";
import { ipHashSchema } from "@/lib/validators/shares";
import { clientIpOf, hashIp, portalSecret } from "./request-meta";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("portal request metadata (C20, C22)", () => {
  it("hashes the IP with the salt into lowercase SHA-256 hex, never the raw IP", () => {
    const hash = hashIp("203.0.113.7", "salt-1");
    expect(ipHashSchema.parse(hash)).toBe(hash);
    expect(hash).not.toContain("203.0.113.7");
    expect(hashIp("203.0.113.7", "salt-1")).toBe(hash);
    expect(hashIp("203.0.113.7", "salt-2")).not.toBe(hash);
  });

  it("reads the client IP from the platform header first, then the first forwarded hop", () => {
    expect(
      clientIpOf(
        new Headers({ "x-nf-client-connection-ip": "198.51.100.1", "x-forwarded-for": "10.0.0.1" }),
      ),
    ).toBe("198.51.100.1");
    expect(clientIpOf(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe(
      "203.0.113.7",
    );
    expect(clientIpOf(new Headers())).toBe("unknown");
  });

  it("uses the configured secret and refuses a missing one in production", () => {
    vi.stubEnv("SHARE_IP_SALT", "configured-salt");
    expect(portalSecret("SHARE_IP_SALT")).toBe("configured-salt");
    vi.stubEnv("SHARE_IP_SALT", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => portalSecret("SHARE_IP_SALT")).toThrow(/SHARE_IP_SALT/);
  });

  it("falls back to a fixed development secret outside production", () => {
    vi.stubEnv("SHARE_UNLOCK_SECRET", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(portalSecret("SHARE_UNLOCK_SECRET")).toMatch(/^dev-only-/);
  });
});
