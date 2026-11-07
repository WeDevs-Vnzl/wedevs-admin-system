import { describe, expect, it } from "vitest";
import { stackChips } from "./stack-chips";

describe("stackChips", () => {
  it("keeps the wire fields and fills the slug the shared chip type asks for", () => {
    const stack = [
      {
        id: "tec_1",
        name: "Next.js",
        nameEn: null,
        category: "FRONTEND" as const,
        iconSlug: "nextdotjs",
        color: null,
      },
    ];
    expect(stackChips(stack)).toEqual([{ ...stack[0], slug: "nextdotjs" }]);
    expect(stackChips([{ ...stack[0]!, iconSlug: null }])[0]?.slug).toBe("");
  });
});
