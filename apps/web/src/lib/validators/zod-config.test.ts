import { describe, expect, it } from "vitest";
import { z } from "./zod";
import { VALIDATION_MESSAGES, dateOnlySchema, idSchema, listQuerySchema } from "./common";
import { ENUM_REGISTRY, clientKindSchema, userRoleSchema } from "./enums";
import { requestUploadInputSchema, uploadContextSchema } from "./files";
import {
  currencyCodeSchema,
  moneyAmountSchema,
  moneyDtoSchema,
  percentSchema,
  rateSchema,
} from "./money";
import { GENERIC_VALIDATION_MESSAGES } from "./zod-config";

function messages(schema: z.ZodType, input: unknown): string[] {
  const result = schema.safeParse(input);
  if (result.success) throw new Error(`expected ${JSON.stringify(input)} to be rejected`);
  return result.error.issues.map((issue) => issue.message);
}

describe("global Zod error map → validation.* keys (C1)", () => {
  it("invalid_type: required when the input is undefined or null, invalidFormat otherwise", () => {
    expect(messages(z.string(), undefined)).toEqual([VALIDATION_MESSAGES.required]);
    expect(messages(z.string(), null)).toEqual([VALIDATION_MESSAGES.required]);
    expect(messages(z.string(), 5)).toEqual([VALIDATION_MESSAGES.invalidFormat]);
    expect(messages(z.object({ a: z.string() }), {})).toEqual([VALIDATION_MESSAGES.required]);
    expect(messages(z.object({ a: z.string() }), { a: null })).toEqual([
      VALIDATION_MESSAGES.required,
    ]);
  });

  it("a cleared (null) required enum/select field reports required, a bad value invalidOption", () => {
    const form = z.object({ role: userRoleSchema, kind: clientKindSchema });
    expect(messages(form, { role: null, kind: "EMPRESA" })).toEqual([VALIDATION_MESSAGES.required]);
    expect(messages(form, { role: undefined, kind: null })).toEqual([
      VALIDATION_MESSAGES.required,
      VALIDATION_MESSAGES.required,
    ]);
    expect(messages(form, { role: "nope", kind: "EMPRESA" })).toEqual([
      VALIDATION_MESSAGES.invalidOption,
    ]);
  });

  it("invalid_value → invalidOption", () => {
    expect(messages(z.enum(["a", "b"]), "c")).toEqual([VALIDATION_MESSAGES.invalidOption]);
    expect(messages(z.literal(1), 2)).toEqual([VALIDATION_MESSAGES.invalidOption]);
  });

  it("too_small / too_big: text and collections use tooShort/tooLong", () => {
    expect(messages(z.string().min(3), "a")).toEqual([VALIDATION_MESSAGES.tooShort]);
    expect(messages(z.string().max(3), "abcd")).toEqual([VALIDATION_MESSAGES.tooLong]);
    expect(messages(z.array(z.string()).min(1), [])).toEqual([VALIDATION_MESSAGES.tooShort]);
    expect(messages(z.string().min(2), "")).toEqual([VALIDATION_MESSAGES.tooShort]);
    expect(messages(z.array(z.string()).max(1), ["a", "b"])).toEqual([VALIDATION_MESSAGES.tooLong]);
  });

  it("too_small on a string with minimum 1 (empty required text) → required", () => {
    expect(messages(z.string().min(1), "")).toEqual([VALIDATION_MESSAGES.required]);
    expect(messages(z.string().nonempty(), "")).toEqual([VALIDATION_MESSAGES.required]);
    expect(messages(z.string().min(1, "custom.short"), "")).toEqual(["custom.short"]);
  });

  it("too_small / too_big: numbers use tooSmall/tooLarge, with positive/nonNegative at zero", () => {
    expect(messages(z.number().min(5), 1)).toEqual([VALIDATION_MESSAGES.tooSmall]);
    expect(messages(z.number().max(5), 9)).toEqual([VALIDATION_MESSAGES.tooLarge]);
    expect(messages(z.number().positive(), 0)).toEqual([VALIDATION_MESSAGES.positive]);
    expect(messages(z.number().nonnegative(), -1)).toEqual([VALIDATION_MESSAGES.nonNegative]);
  });

  it("invalid_format → invalidFormat, and invalidEmail for emails", () => {
    expect(messages(z.string().regex(/^a+$/), "b")).toEqual([VALIDATION_MESSAGES.invalidFormat]);
    expect(messages(z.string().uuid(), "nope")).toEqual([VALIDATION_MESSAGES.invalidFormat]);
    expect(messages(z.email(), "nope")).toEqual([VALIDATION_MESSAGES.invalidEmail]);
  });

  it("falls back to invalidFormat for any other issue", () => {
    expect(messages(z.number().multipleOf(5), 3)).toEqual([VALIDATION_MESSAGES.invalidFormat]);
    expect(
      messages(
        z.string().refine(() => false),
        "x",
      ),
    ).toEqual([VALIDATION_MESSAGES.invalidFormat]);
    expect(messages(z.union([z.string(), z.number()]), true)).toEqual([
      VALIDATION_MESSAGES.invalidFormat,
    ]);
    expect(messages(z.strictObject({}), { extra: 1 })).toEqual([VALIDATION_MESSAGES.invalidFormat]);
  });

  it("custom messages keep precedence", () => {
    expect(messages(z.string("custom.type"), 5)).toEqual(["custom.type"]);
    expect(messages(z.string().min(3, "custom.short"), "a")).toEqual(["custom.short"]);
    expect(
      messages(
        z.string().refine(() => false, { message: "custom.refine" }),
        "x",
      ),
    ).toEqual(["custom.refine"]);
  });

  it("registers every generic key in VALIDATION_MESSAGES", () => {
    for (const [name, key] of Object.entries(GENERIC_VALIDATION_MESSAGES)) {
      expect(VALIDATION_MESSAGES[name as keyof typeof VALIDATION_MESSAGES]).toBe(key);
      expect(key.startsWith("validation.")).toBe(true);
    }
  });
});

describe("every exported primitive schema reports only validation.* keys", () => {
  const BAD_INPUTS: unknown[] = [
    undefined,
    null,
    "",
    " ",
    "not valid",
    "-1",
    "1.234567891",
    "2026-02-30",
    "1e3",
    "../x",
    "x".repeat(300),
    0,
    -1,
    1.5,
    NaN,
    true,
    [],
    {},
    [1, "a"],
  ];

  const stringEnumSchemas = Object.values(ENUM_REGISTRY).map((values) => z.enum(values));

  const schemas: Record<string, z.ZodType> = {
    idSchema,
    dateOnlySchema,
    listQuerySchema,
    "moneyAmountSchema()": moneyAmountSchema(),
    "moneyAmountSchema(nonNegative)": moneyAmountSchema({ sign: "nonNegative" }),
    "moneyAmountSchema(any)": moneyAmountSchema({ sign: "any" }),
    rateSchema,
    percentSchema,
    currencyCodeSchema,
    moneyDtoSchema,
    requestUploadInputSchema,
    uploadContextSchema,
    userRoleSchema,
    clientKindSchema,
    ...Object.fromEntries(stringEnumSchemas.map((schema, i) => [`enums[${i}]`, schema])),
  };

  it.each(Object.entries(schemas))("%s", (_name, schema) => {
    let rejected = 0;
    for (const input of BAD_INPUTS) {
      const result = schema.safeParse(input);
      if (result.success) continue;
      rejected += 1;
      for (const issue of result.error.issues) {
        expect(issue.message, `${JSON.stringify(input)}`).toMatch(/^validation\./);
      }
    }
    expect(rejected).toBeGreaterThan(0);
  });

  it("reports validation.* keys for bad object members of composite schemas", () => {
    const bad = [{ amount: 5, currency: "usd" }, { amount: "1.234", currency: "usd" }, {}];
    for (const input of bad) {
      for (const message of messages(moneyDtoSchema, input))
        expect(message).toMatch(/^validation\./);
    }
    for (const input of [
      { page: 0, pageSize: 30, sort: "bad", q: 5, filters: { a: 1 }, includeArchived: "maybe" },
      { page: "x", filters: [] },
    ]) {
      for (const message of messages(listQuerySchema, input))
        expect(message).toMatch(/^validation\./);
    }
    for (const input of [
      { name: 5, mime: 5, size: "x", context: "avatar" },
      { name: "a.pdf", mime: "application/pdf", size: 1.5, context: "general" },
    ]) {
      for (const message of messages(requestUploadInputSchema, input)) {
        expect(message).toMatch(/^validation\./);
      }
    }
  });
});
