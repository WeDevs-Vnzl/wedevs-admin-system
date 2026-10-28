import { describe, expect, it } from "vitest";
import { ERROR_CODE_VALUES } from "@/lib/validators/common";
import { toActionResult } from "./errors";
import { ERROR_HTTP_STATUS, errorEnvelope, mockApi } from "./testing";

describe("mockApi", () => {
  it("answers from the route table and records calls with the bearer token", async () => {
    const { api, calls } = mockApi({ "GET /api/v1/me": { body: { id: "u1" } } });
    const result = await api.GET("/api/v1/me" as never);
    expect(result.data).toEqual({ id: "u1" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.path).toBe("/api/v1/me");
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer test-token");
  });

  it("matches {param} segments and exposes the JSON body and query", async () => {
    const { api, calls } = mockApi({
      "POST /api/v1/clients/{id}/archive": (call) => ({ status: 201, body: { echoed: call.body } }),
    });
    const result = await api.POST(
      "/api/v1/clients/c1/archive?x=1" as never,
      { body: { reason: "r" } } as never,
    );
    expect(result.data).toEqual({ echoed: { reason: "r" } });
    expect(calls[0]?.search.get("x")).toBe("1");
  });

  it("supports a signed-out token and a 204", async () => {
    const { api, calls } = mockApi({ "DELETE /api/v1/x": { status: 204 } }, { token: null });
    const result = await api.DELETE("/api/v1/x" as never);
    expect(result.response.status).toBe(204);
    expect(calls[0]?.headers.has("authorization")).toBe(false);
  });

  it("rejects like a network failure when no route matches", async () => {
    const { api } = mockApi({});
    await expect(api.GET("/api/v1/nope" as never)).rejects.toThrow(
      /no route for GET \/api\/v1\/nope/,
    );
  });

  it("errorEnvelope builds the contract envelope the mapper reads", async () => {
    const { api } = mockApi({
      "POST /api/v1/clients": errorEnvelope("VALIDATION", {
        fieldErrors: { name: ["validation.required"] },
      }),
    });
    const res = await api.POST("/api/v1/clients" as never, { body: {} } as never);
    expect(res.response.status).toBe(422);
    const mapped = toActionResult(res as never);
    expect(mapped.ok).toBe(false);
    if (!mapped.ok) expect(mapped.error.fieldErrors).toEqual({ name: ["validation.required"] });
  });

  it("has an HTTP status for every error code", () => {
    for (const code of ERROR_CODE_VALUES)
      expect(ERROR_HTTP_STATUS[code]).toBeGreaterThanOrEqual(400);
  });
});
