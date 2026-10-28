import type { ContactsService } from "./contacts";
import { describe, expect, it } from "vitest";
import { VALIDATION_MESSAGES } from "./common";
import {
  contactDetailSchema,
  contactFilterSchema,
  createContactInputSchema,
  e164PhoneSchema,
  isE164Phone,
  optionalPhoneSchema,
  setPrimaryContactInputSchema,
  updateContactInputSchema,
} from "./contacts";

const issues = (result: { error?: { issues: { path: PropertyKey[]; message: string }[] } }) =>
  (result.error?.issues ?? []).map((i) => `${i.path.join(".")}:${i.message}`);

describe("E.164 phone", () => {
  it.each(["+584121234567", "+14155552671", "+1234567"])("accepts %s", (v) => {
    expect(isE164Phone(v)).toBe(true);
    expect(e164PhoneSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    "04121234567",
    "+0123456789",
    "+58 412 1234567",
    "+58-412-1234567",
    "+12",
    "+1234567890123456",
    "",
    "abc",
  ])("rejects %j", (v) => {
    expect(e164PhoneSchema.safeParse(v).success).toBe(false);
  });

  it("optional phone allows empty and still validates the rest", () => {
    expect(optionalPhoneSchema.parse("")).toBeUndefined();
    expect(optionalPhoneSchema.safeParse("0412").success).toBe(false);
  });
});

describe("createContact", () => {
  const valid = { clientId: "cli_1", fullName: "Lucía Pérez", email: "lucia@example.com" };

  it("accepts a name with only an e-mail, only a phone, or both", () => {
    expect(createContactInputSchema.safeParse(valid).success).toBe(true);
    expect(
      createContactInputSchema.safeParse({
        clientId: "cli_1",
        fullName: "Lucía",
        phone: "+584121234567",
      }).success,
    ).toBe(true);
    expect(
      createContactInputSchema.safeParse({ ...valid, phone: "+584121234567", isPrimary: true })
        .success,
    ).toBe(true);
  });

  it("defaults isPrimary to false and tags to none", () => {
    const parsed = createContactInputSchema.parse(valid);
    expect(parsed.isPrimary).toBe(false);
    expect(parsed.tagIds).toEqual([]);
  });

  it("requires at least one contact method, reported on both fields", () => {
    const result = createContactInputSchema.safeParse({ clientId: "cli_1", fullName: "Lucía" });
    expect(result.success).toBe(false);
    expect(issues(result)).toEqual([
      `email:${VALIDATION_MESSAGES.required}`,
      `phone:${VALIDATION_MESSAGES.required}`,
    ]);
    // Empty strings from a form count as missing.
    expect(
      createContactInputSchema.safeParse({
        clientId: "cli_1",
        fullName: "Lucía",
        email: "",
        phone: "",
      }).success,
    ).toBe(false);
  });

  it("requires a name and rejects a malformed e-mail or phone", () => {
    expect(createContactInputSchema.safeParse({ ...valid, fullName: "  " }).success).toBe(false);
    expect(createContactInputSchema.safeParse({ ...valid, email: "x" }).success).toBe(false);
    expect(createContactInputSchema.safeParse({ ...valid, phone: "0412" }).success).toBe(false);
    expect(createContactInputSchema.safeParse({ fullName: "A", email: "a@b.co" }).success).toBe(
      false,
    );
  });

  it("updateContact keeps the same rules and needs an id", () => {
    expect(updateContactInputSchema.safeParse({ id: "ct_1", ...valid }).success).toBe(true);
    expect(updateContactInputSchema.safeParse({ id: "ct_1", fullName: "Lucía" }).success).toBe(
      false,
    );
    expect(setPrimaryContactInputSchema.safeParse({ id: "ct_1" }).success).toBe(true);
  });
});

describe("contact DTOs and filters", () => {
  it("filters contacts of one client", () => {
    expect(
      contactFilterSchema.safeParse({ clientId: "cli_1", sort: "isPrimary:desc" }).success,
    ).toBe(true);
    expect(contactFilterSchema.safeParse({}).success).toBe(false);
  });

  it("detail DTO", () => {
    expect(
      contactDetailSchema.safeParse({
        id: "ct_1",
        clientId: "cli_1",
        fullName: "Lucía Pérez",
        position: null,
        email: "lucia@example.com",
        phone: null,
        isPrimary: true,
        tags: [],
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:00:00.000Z",
        archivedAt: null,
      }).success,
    ).toBe(true);
  });
});

describe("ContactsService (PRD §12 service names)", () => {
  it("declares every service of the module with its exact name", () => {
    const names = [
      "createContact",
      "updateContact",
      "setPrimaryContact",
      "archiveContact",
    ] as const satisfies readonly (keyof ContactsService)[];
    expect(new Set(names).size).toBe(names.length);
  });
});
