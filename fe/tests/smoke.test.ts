import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("scaffold smoke test", () => {
  it("resolves the @/* alias and merges class names", () => {
    expect(cn("px-2", "px-4", "font-sans")).toBe("px-4 font-sans");
  });
});
