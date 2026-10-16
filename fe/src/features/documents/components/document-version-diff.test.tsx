import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import { DocumentVersionDiff, diffDocumentLines } from "./document-version-diff";

function renderDiff(before: string, after: string) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ documents: enDocuments }}>
      <DocumentVersionDiff before={before} after={after} />
    </NextIntlClientProvider>,
  );
}

describe("diffDocumentLines (S5: text diff, markdown only)", () => {
  it("splits the change into kept, removed and added lines, in order", () => {
    expect(diffDocumentLines("# PRD\nAlcance v1\nFin", "# PRD\nAlcance v2\nFin\nAnexo")).toEqual([
      { kind: "same", text: "# PRD" },
      { kind: "removed", text: "Alcance v1" },
      { kind: "added", text: "Alcance v2" },
      { kind: "same", text: "Fin" },
      { kind: "added", text: "Anexo" },
    ]);
  });
});

describe("DocumentVersionDiff", () => {
  it("marks removed and added lines with text, not color alone", () => {
    renderDiff("Alcance v1\nFin", "Alcance v2\nFin");
    const list = screen.getByRole("list", { name: "Diff legend" });
    const removed = within(list).getByText("Alcance v1").closest("li")!;
    const added = within(list).getByText("Alcance v2").closest("li")!;
    expect(removed).toHaveTextContent(/^Removed/);
    expect(added).toHaveTextContent(/^Added/);
    expect(removed).toHaveAttribute("data-kind", "removed");
    expect(added).toHaveAttribute("data-kind", "added");
    expect(within(list).getByText("Fin").closest("li")).toHaveAttribute("data-kind", "same");
  });

  it("says so when the two versions are identical", () => {
    renderDiff("Igual", "Igual");
    expect(
      screen.getByText("This version has the same content as the current one."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});
