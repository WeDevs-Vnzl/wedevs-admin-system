import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EntityCodeChip } from "./entity-code-chip";

describe("EntityCodeChip", () => {
  it("renders the record code as monospaced text", () => {
    render(<EntityCodeChip code="CLI-0007" />);

    const chip = screen.getByText("CLI-0007");
    expect(chip).toHaveClass("font-mono", "rounded-md");
    expect(chip.tagName).toBe("SPAN");
  });

  it("merges a custom className with the chip classes", () => {
    render(<EntityCodeChip code="INV-0001" className="ml-2" />);
    expect(screen.getByText("INV-0001")).toHaveClass("ml-2", "font-mono");
  });

  it("keeps codes with no separator or unusual casing as they are", () => {
    render(<EntityCodeChip code="x-2026" />);
    expect(screen.getByText("x-2026")).toBeInTheDocument();
  });
});
