import { describe, expect, it } from "vitest";
import { clientKindSchema, userRoleSchema } from "./enums";

// Isolation (C1): this file imports ONLY `./enums` — never `./common`, `./money` or `./files` — so it
// proves the global Zod error map is installed by `./zod` itself and not as a side effect of another module.

describe("enums imported alone still report validation.* keys", () => {
  it("rejects a bad enum value with validation.invalidOption", () => {
    for (const schema of [userRoleSchema, clientKindSchema]) {
      const result = schema.safeParse("not-a-value");
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((issue) => issue.message)).toEqual([
          "validation.invalidOption",
        ]);
      }
    }
  });

  it("rejects a missing or non-string value with validation.* keys", () => {
    for (const input of [undefined, null, 5, {}]) {
      const result = userRoleSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) {
        for (const issue of result.error.issues) expect(issue.message).toMatch(/^validation\./);
      }
    }
  });
});
