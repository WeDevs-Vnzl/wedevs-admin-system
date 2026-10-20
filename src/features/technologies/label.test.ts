import { describe, expect, it } from "vitest";
import { technologyLabel } from "./label";

describe("technologyLabel (DT-72)", () => {
  const withEnglish = { name: "Base de datos", nameEn: "Database" };
  const withoutEnglish = { name: "Next.js", nameEn: null };

  it("shows the English name in English when there is one", () => {
    expect(technologyLabel(withEnglish, "en")).toBe("Database");
  });

  it("falls back to the Spanish name in English when nameEn is empty", () => {
    expect(technologyLabel(withoutEnglish, "en")).toBe("Next.js");
  });

  it("always shows the Spanish name in Spanish", () => {
    expect(technologyLabel(withEnglish, "es")).toBe("Base de datos");
    expect(technologyLabel(withoutEnglish, "es")).toBe("Next.js");
  });
});
