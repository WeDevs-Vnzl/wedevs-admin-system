import { describe, expect, it } from "vitest";
import { z } from "./zod";
import {
  DEFAULT_PAGE_SIZE,
  ERROR_CODE_VALUES,
  VALIDATION_MESSAGES,
  actionError,
  actionOk,
  dateOnlySchema,
  entityRefSchema,
  errorMessageKey,
  facetOf,
  hexColorSchema,
  idSchema,
  isValidDateOnly,
  listQuerySchema,
  optionalText,
  paginated,
  parseSort,
  requiredText,
  sortsBy,
  timestampSchema,
  withSortFields,
  zodFieldErrors,
  type ActionResult,
} from "./common";

describe("error codes and ActionResult", () => {
  it("lists exactly the PRD error codes", () => {
    expect([...ERROR_CODE_VALUES]).toEqual([
      "UNAUTHENTICATED",
      "FORBIDDEN",
      "VALIDATION",
      "NOT_FOUND",
      "CONFLICT",
      "INTEGRITY_LOCK",
      "ACCESS_KEY_INVALID",
      "ACCESS_KEY_LOCKED",
      "INTERNAL",
    ]);
  });

  it("actionOk wraps data and only carries warnings when there are some", () => {
    expect(actionOk(1)).toEqual({ ok: true, data: 1 });
    expect(actionOk(1, [])).toEqual({ ok: true, data: 1 });
    const warning = { code: "DUPLICATE_PAYMENT", message: "payments.warnings.duplicate" };
    expect(actionOk(1, [warning])).toEqual({ ok: true, data: 1, warnings: [warning] });
  });

  it("actionError defaults the message to an i18n key and keeps fieldErrors", () => {
    expect(actionError("FORBIDDEN")).toEqual({
      ok: false,
      error: { code: "FORBIDDEN", message: "common.errors.FORBIDDEN" },
    });
    expect(errorMessageKey("NOT_FOUND")).toBe("common.errors.NOT_FOUND");
    expect(
      actionError("VALIDATION", "validation.required", { name: ["validation.required"] }),
    ).toEqual({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "validation.required",
        fieldErrors: { name: ["validation.required"] },
      },
    });
  });

  it("narrows through the discriminant", () => {
    const result: ActionResult<number> = actionOk(7);
    if (result.ok) expect(result.data).toBe(7);
    else throw new Error("expected ok");
  });

  it("zodFieldErrors keys by dotted path and uses _form for root issues", () => {
    const schema = z
      .object({ lines: z.array(z.object({ qty: z.string().min(1, "validation.required") })) })
      .refine(() => false, { message: "validation.invalid" });
    const parsed = schema.safeParse({ lines: [{ qty: "" }] });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(zodFieldErrors(parsed.error)).toEqual({
        "lines.0.qty": ["validation.required"],
        _form: ["validation.invalid"],
      });
    }
    const root = z.string().safeParse(1);
    if (!root.success) expect(Object.keys(zodFieldErrors(root.error))).toEqual(["_form"]);
  });
});

describe("idSchema and entityRefSchema", () => {
  it("accepts cuids and readable mock ids", () => {
    expect(idSchema.safeParse("clx9f3k2a0000abcd1234").success).toBe(true);
    expect(idSchema.safeParse("cli_kairos-studio").success).toBe(true);
  });

  it("rejects empty, over-long and unsafe ids", () => {
    expect(idSchema.safeParse("").success).toBe(false);
    expect(idSchema.safeParse("a".repeat(65)).success).toBe(false);
    expect(idSchema.safeParse("a b").success).toBe(false);
    expect(idSchema.safeParse("../etc").success).toBe(false);
  });

  it("validates an EntityRef with an optional code and a known type", () => {
    const ref = { id: "cli_1", code: "CLI-0001", label: "Kairos Studio LLC", type: "CLIENT" };
    expect(entityRefSchema.parse(ref)).toEqual(ref);
    expect(entityRefSchema.safeParse({ id: "cli_1", label: "x", type: "CLIENT" }).success).toBe(
      true,
    );
    expect(entityRefSchema.safeParse({ ...ref, type: "NOPE" }).success).toBe(false);
  });
});

describe("dateOnlySchema", () => {
  it.each(["2026-10-09", "2024-02-29", "1999-12-31"])("accepts %s", (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(true);
  });

  it.each([
    "2026-13-01",
    "2026-00-10",
    "2026-02-30",
    "2025-02-29",
    "2026-1-1",
    "26-10-09",
    "2026-10-09T00:00:00Z",
    "09/10/2026",
    "",
  ])("rejects %s", (value) => {
    expect(dateOnlySchema.safeParse(value).success).toBe(false);
  });

  it("reports the i18n key and exposes the predicate", () => {
    const result = dateOnlySchema.safeParse("nope");
    if (!result.success)
      expect(result.error.issues[0]?.message).toBe(VALIDATION_MESSAGES.invalidDate);
    expect(isValidDateOnly("2026-10-09")).toBe(true);
  });
});

describe("listQuerySchema", () => {
  it("applies defaults", () => {
    expect(listQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: DEFAULT_PAGE_SIZE,
      filters: {},
      includeArchived: false,
    });
  });

  it("coerces URL strings", () => {
    const parsed = listQuerySchema.parse({
      page: "3",
      pageSize: "50",
      sort: "createdAt:desc",
      q: "  kairos ",
      filters: { status: ["ACTIVO", "PROSPECTO"], currency: "USD" },
      includeArchived: "true",
    });
    expect(parsed).toEqual({
      page: 3,
      pageSize: 50,
      sort: "createdAt:desc",
      q: "kairos",
      filters: { status: ["ACTIVO", "PROSPECTO"], currency: "USD" },
      includeArchived: true,
    });
  });

  it("accepts real booleans and numbers too", () => {
    const parsed = listQuerySchema.parse({ page: 2, pageSize: 100, includeArchived: true });
    expect(parsed).toMatchObject({ page: 2, pageSize: 100, includeArchived: true });
  });

  it.each([0, -1, 1.5, "abc"])("rejects page %s", (page) => {
    expect(listQuerySchema.safeParse({ page }).success).toBe(false);
  });

  it.each([10, 24, 101, 200, "30"])("rejects pageSize %s", (pageSize) => {
    expect(listQuerySchema.safeParse({ pageSize }).success).toBe(false);
  });

  it.each(["name", "name:up", ":asc", "1name:asc", "name:asc;drop", "name:ASC"])(
    "rejects sort %s",
    (sort) => {
      expect(listQuerySchema.safeParse({ sort }).success).toBe(false);
    },
  );

  it("accepts nested sort fields and turns an empty q into undefined", () => {
    expect(listQuerySchema.parse({ sort: "client.name:asc" }).sort).toBe("client.name:asc");
    expect(listQuerySchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it("rejects an oversized q and a non-string filter value", () => {
    expect(listQuerySchema.safeParse({ q: "x".repeat(201) }).success).toBe(false);
    expect(listQuerySchema.safeParse({ filters: { a: 1 } }).success).toBe(false);
  });

  it("can be extended by module filter schemas", () => {
    const clientsQuery = listQuerySchema.extend({
      status: z.enum(["ACTIVO", "INACTIVO"]).optional(),
    });
    expect(clientsQuery.parse({ status: "ACTIVO" }).status).toBe("ACTIVO");
    expect(clientsQuery.safeParse({ status: "X" }).success).toBe(false);
  });
});

describe("parseSort and paginated", () => {
  it("parseSort splits field and direction", () => {
    expect(parseSort("createdAt:desc")).toEqual({ field: "createdAt", direction: "desc" });
    expect(parseSort(undefined)).toBeNull();
    expect(parseSort("bad")).toBeNull();
  });

  it("paginated computes pageCount (at least 1)", () => {
    expect(paginated(["a"], 51, { page: 1, pageSize: 25 })).toEqual({
      items: ["a"],
      total: 51,
      page: 1,
      pageSize: 25,
      pageCount: 3,
    });
    expect(paginated([], 0, { page: 1, pageSize: 25 }).pageCount).toBe(1);
  });
});

describe("shared form and list primitives (M4)", () => {
  const messagesOf = (result: { error?: { issues: { message: string }[] } }) =>
    (result.error?.issues ?? []).map((issue) => issue.message);

  it("timestampSchema is strict ISO 8601 UTC", () => {
    for (const ok of ["2026-10-09T14:30:00.000Z", "2026-10-09T14:30:00Z"]) {
      expect(timestampSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of [
      "2026-10-09",
      "2026-10-09T14:30:00+02:00",
      "2026-10-09 14:30:00",
      "",
      "yesterday",
    ]) {
      expect(timestampSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(timestampSchema.safeParse(1760000000000).success).toBe(false);
  });

  it("hexColorSchema accepts exactly #RRGGBB", () => {
    for (const ok of ["#000000", "#1A2b3C", "#ffffff"]) {
      expect(hexColorSchema.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["#fff", "#12345", "#1234567", "123456", "#GGGGGG", "blue", ""]) {
      expect(hexColorSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(messagesOf(hexColorSchema.safeParse("#fff"))).toEqual([
      VALIDATION_MESSAGES.invalidFormat,
    ]);
  });

  it("requiredText trims, rejects blank and bounds the length", () => {
    const schema = requiredText(5);
    expect(schema.parse("  abc ")).toBe("abc");
    expect(messagesOf(schema.safeParse("   "))).toEqual([VALIDATION_MESSAGES.required]);
    expect(schema.safeParse("123456").success).toBe(false);
    expect(schema.safeParse(undefined).success).toBe(false);
  });

  it("optionalText trims, bounds, and turns empty, null and missing into undefined", () => {
    const schema = z.object({ note: optionalText(5) });
    expect(schema.parse({ note: " hi " })).toEqual({ note: "hi" });
    expect(schema.parse({ note: "" }).note).toBeUndefined();
    expect(schema.parse({ note: "   " }).note).toBeUndefined();
    expect(schema.parse({ note: null }).note).toBeUndefined();
    expect(schema.parse({}).note).toBeUndefined();
    expect(schema.safeParse({ note: "123456" }).success).toBe(false);
    expect(schema.safeParse({ note: 5 }).success).toBe(false);
  });

  it("facetOf normalizes one value or a list to a list and keeps undefined", () => {
    const schema = z.object({ status: facetOf(z.enum(["A", "B"])) });
    expect(schema.parse({ status: "A" }).status).toEqual(["A"]);
    expect(schema.parse({ status: ["A", "B"] }).status).toEqual(["A", "B"]);
    expect(schema.parse({ status: [] }).status).toEqual([]);
    expect(schema.parse({}).status).toBeUndefined();
    expect(schema.safeParse({ status: "C" }).success).toBe(false);
    expect(schema.safeParse({ status: ["A", "C"] }).success).toBe(false);
  });

  it("sortsBy and withSortFields whitelist the sort field", () => {
    expect(sortsBy(undefined, ["name"])).toBe(true);
    expect(sortsBy("name:asc", ["name"])).toBe(true);
    expect(sortsBy("other:asc", ["name"])).toBe(false);
    expect(sortsBy("garbage", ["name"])).toBe(false);

    const schema = withSortFields(listQuerySchema, ["name", "createdAt"]);
    expect(schema.safeParse({}).success).toBe(true);
    expect(schema.safeParse({ sort: "createdAt:desc" }).success).toBe(true);
    const bad = schema.safeParse({ sort: "secret:asc" });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({
      message: VALIDATION_MESSAGES.invalidSort,
      path: ["sort"],
    });
  });

  it("withSortFields documented path: derive from the base object, then wrap", () => {
    const base = listQuerySchema.extend({
      status: z.string().optional(),
      note: z.string().optional(),
    });
    const picked = withSortFields(base.pick({ page: true, sort: true, status: true }), ["name"]);
    expect(picked.safeParse({ sort: "name:asc", status: "A" }).success).toBe(true);
    expect(picked.safeParse({ sort: "other:asc" }).success).toBe(false);
    const partial = withSortFields(base.partial(), ["name"]);
    expect(partial.safeParse({}).success).toBe(true);
    expect(partial.safeParse({ sort: "other:asc" }).success).toBe(false);
  });
});
