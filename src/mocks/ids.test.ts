// MOCK — tests for the mock ids and code sequences.
import { describe, expect, it } from "vitest";
import { idSchema } from "@/lib/validators/common";
import {
  CODE_PREFIX_VALUES,
  createMockSequences,
  formatCode,
  mockId,
  nextMockCode,
  nextMockId,
  parseCode,
  syncMockSequences,
} from "./ids";

describe("codes", () => {
  it("covers the six prefixes of data-rules §5", () => {
    expect([...CODE_PREFIX_VALUES]).toEqual(["CLI", "PRY", "FAC", "PAG", "GAS", "DOC"]);
  });

  it("pads to four digits and keeps growing past 9999", () => {
    expect(formatCode("CLI", 7)).toBe("CLI-0007");
    expect(formatCode("FAC", 9999)).toBe("FAC-9999");
    expect(formatCode("FAC", 10000)).toBe("FAC-10000");
  });

  it("parses the numeric part of a code of the right prefix only", () => {
    expect(parseCode("CLI", "CLI-0042")).toBe(42);
    expect(parseCode("CLI", "PRY-0042")).toBeNull();
    expect(parseCode("CLI", "CLI-42")).toBeNull();
    expect(parseCode("CLI", "xCLI-0042")).toBeNull();
  });

  it("allocates codes from 1, one sequence per prefix", () => {
    const sequences = createMockSequences();
    expect(nextMockCode(sequences, "CLI")).toBe("CLI-0001");
    expect(nextMockCode(sequences, "CLI")).toBe("CLI-0002");
    expect(nextMockCode(sequences, "PRY")).toBe("PRY-0001");
    expect(sequences).toEqual({ CLI: 2, PRY: 1, FAC: 0, PAG: 0, GAS: 0, DOC: 0 });
  });

  it("raises a sequence to the highest code present, never lowers it (no max + 1 on a live table)", () => {
    const sequences = createMockSequences();
    sequences.CLI = 10;
    syncMockSequences(sequences, {
      CLI: ["CLI-0003", "CLI-0007"],
      FAC: ["FAC-0042", "FAC-0007", "bogus"],
    });
    expect(sequences.CLI).toBe(10);
    expect(sequences.FAC).toBe(42);
    expect(nextMockCode(sequences, "FAC")).toBe("FAC-0043");
  });
});

describe("mockId", () => {
  it("builds readable ids that satisfy the id contract", () => {
    expect(mockId("cli", "kairos")).toBe("cli_kairos");
    expect(idSchema.safeParse(mockId("inv", "0042")).success).toBe(true);
  });

  it("rejects ids the contract would reject", () => {
    expect(() => mockId("cli", "not valid")).toThrow(RangeError);
    expect(() => mockId("CLI", "x")).toThrow(RangeError);
    expect(() => mockId("cli", "x".repeat(70))).toThrow(RangeError);
  });

  it("generates runtime ids per kind and skips the taken ones", () => {
    const counters = {};
    expect(nextMockId(counters, "fil")).toBe("fil_0001");
    expect(nextMockId(counters, "fil")).toBe("fil_0002");
    expect(nextMockId(counters, "tag")).toBe("tag_0001");
    expect(nextMockId(counters, "fil", (id) => id === "fil_0003")).toBe("fil_0004");
  });
});
