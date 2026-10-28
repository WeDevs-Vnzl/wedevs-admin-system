import { describe, expect, expectTypeOf, it } from "vitest";
import { ERROR_CODE_VALUES, type ErrorCode } from "@/lib/validators/common";
import type { components } from "./schema";
import {
  SIGN_IN_PATH,
  envelopeToActionError,
  fromThrown,
  isInvalidSortError,
  toActionResult,
} from "./errors";

type GeneratedCode = components["schemas"]["ErrorResponse"]["error"]["code"];

function envelope(code: string, extra: Record<string, unknown> = {}) {
  return {
    error: {
      code,
      message: `common.errors.${code}`,
      fieldErrors: null,
      entity: null,
      correlationId: "corr-1",
      ...extra,
    },
  };
}

describe("error code coverage", () => {
  it("ERROR_CODE_VALUES equals the generated ErrorResponse enum", () => {
    expectTypeOf<ErrorCode>().toEqualTypeOf<GeneratedCode>();
    expect(ERROR_CODE_VALUES).toContain("RATE_LIMITED");
  });

  it.each(ERROR_CODE_VALUES)("maps %s to an ActionResult error with the same code", (code) => {
    const result = toActionResult({
      error: envelope(code),
      response: new Response(null, { status: 400 }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(code);
    expect(result.error.message).toBe(`common.errors.${code}`);
    expect(result.error.correlationId).toBe("corr-1");
  });
});

describe("envelopeToActionError", () => {
  it("keeps VALIDATION fieldErrors keyed by input path", () => {
    const error = envelopeToActionError(
      envelope("VALIDATION", {
        fieldErrors: { name: ["validation.required"], "lines.0.quantity": ["validation.min"] },
      }),
    );
    expect(error.code).toBe("VALIDATION");
    expect(error.fieldErrors).toEqual({
      name: ["validation.required"],
      "lines.0.quantity": ["validation.min"],
    });
  });

  it("omits fieldErrors and entity when null", () => {
    const error = envelopeToActionError(envelope("NOT_FOUND"));
    expect(error).not.toHaveProperty("fieldErrors");
    expect(error).not.toHaveProperty("entity");
  });

  it("carries the CONFLICT entity, dropping a null code", () => {
    const withCode = envelopeToActionError(
      envelope("CONFLICT", {
        entity: { type: "CLIENT", id: "c1", code: "CLI-0007", label: "Acme" },
      }),
    );
    expect(withCode.entity).toEqual({ type: "CLIENT", id: "c1", code: "CLI-0007", label: "Acme" });
    const noCode = envelopeToActionError(
      envelope("CONFLICT", { entity: { type: "CLIENT", id: "c1", code: null, label: "Acme" } }),
    );
    expect(noCode.entity).toEqual({ type: "CLIENT", id: "c1", label: "Acme" });
  });

  it("signals the sign-in redirect only for UNAUTHENTICATED", () => {
    expect(envelopeToActionError(envelope("UNAUTHENTICATED")).redirectTo).toBe(SIGN_IN_PATH);
    expect(SIGN_IN_PATH).toBe("/sign-in");
    expect(envelopeToActionError(envelope("FORBIDDEN"))).not.toHaveProperty("redirectTo");
    expect(envelopeToActionError(envelope("ACCESS_KEY_INVALID"))).not.toHaveProperty("redirectTo");
  });

  it("uses the server i18n key when it looks like one", () => {
    expect(
      envelopeToActionError(envelope("CONFLICT", { message: "clients.errors.taxIdInUse" })).message,
    ).toBe("clients.errors.taxIdInUse");
  });

  it("falls back to common.errors.<code> for prose, empty or non-string messages", () => {
    for (const message of ["Something broke", "", "has spaces.in it", 42, null]) {
      expect(envelopeToActionError(envelope("CONFLICT", { message })).message).toBe(
        "common.errors.CONFLICT",
      );
    }
  });

  it("falls back when the injected catalog does not know the key", () => {
    const error = envelopeToActionError(envelope("CONFLICT", { message: "clients.errors.nope" }), {
      isKnownKey: () => false,
    });
    expect(error.message).toBe("common.errors.CONFLICT");
  });

  it("turns an unknown code or malformed envelope into INTERNAL", () => {
    expect(envelopeToActionError(envelope("TEAPOT")).code).toBe("INTERNAL");
    for (const bad of [null, undefined, "<html>502</html>", 12, {}, { error: "x" }]) {
      expect(envelopeToActionError(bad).code).toBe("INTERNAL");
    }
  });

  it("filters non-string fieldErrors entries", () => {
    const error = envelopeToActionError(
      envelope("VALIDATION", { fieldErrors: { a: ["validation.required", 3], b: "x" } }),
    );
    expect(error.fieldErrors).toEqual({ a: ["validation.required"] });
  });
});

describe("toActionResult", () => {
  it("returns ok with data on success", () => {
    const result = toActionResult({
      data: { id: "1" },
      response: new Response(null, { status: 200 }),
    });
    expect(result).toEqual({ ok: true, data: { id: "1" } });
  });

  it("returns ok with undefined data for a 204", () => {
    const result = toActionResult({
      data: undefined,
      response: new Response(null, { status: 204 }),
    });
    expect(result).toEqual({ ok: true, data: undefined });
  });

  it("maps a non-JSON error body (text) to INTERNAL", () => {
    const result = toActionResult({
      error: "Bad gateway",
      response: new Response("Bad gateway", { status: 502 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("INTERNAL");
  });

  it("keeps the 422 validation.sort.invalid on the sort field", () => {
    const result = toActionResult({
      error: envelope("VALIDATION", { fieldErrors: { sort: ["validation.sort.invalid"] } }),
      response: new Response(null, { status: 422 }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.fieldErrors).toEqual({ sort: ["validation.sort.invalid"] });
    expect(isInvalidSortError(result.error)).toBe(true);
  });
});

describe("isInvalidSortError", () => {
  it("is false for other errors", () => {
    expect(isInvalidSortError(envelopeToActionError(envelope("NOT_FOUND")))).toBe(false);
    expect(
      isInvalidSortError(
        envelopeToActionError(
          envelope("VALIDATION", { fieldErrors: { name: ["validation.required"] } }),
        ),
      ),
    ).toBe(false);
  });
});

describe("fromThrown", () => {
  it("maps a network failure to INTERNAL", () => {
    const result = fromThrown(new TypeError("fetch failed"));
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("INTERNAL");
    expect(result.error.message).toBe("common.errors.INTERNAL");
  });
});
