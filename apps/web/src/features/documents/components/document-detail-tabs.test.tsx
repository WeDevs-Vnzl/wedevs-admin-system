import { render, screen } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { NextIntlClientProvider } from "next-intl";
import { describe, expect, it } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import { DocumentDetailTabs, type DocumentDetailTabsProps } from "./document-detail-tabs";

const slots: DocumentDetailTabsProps = {
  documentId: "doc_1",
  versionCount: 3,
  linkCount: 2,
  content: <p>content slot</p>,
  versions: <p>versions slot</p>,
  links: <p>links slot</p>,
  shares: <p>shares slot</p>,
  notes: <p>notes slot</p>,
  activity: <p>activity slot</p>,
};

function renderTabs(
  search: string,
  props: Partial<DocumentDetailTabsProps> = {},
  locale: "en" | "es" = "en",
) {
  return render(
    <NuqsTestingAdapter searchParams={search}>
      <NextIntlClientProvider
        locale={locale}
        messages={{ documents: locale === "en" ? enDocuments : esDocuments }}
      >
        <DocumentDetailTabs {...slots} {...props} />
      </NextIntlClientProvider>
    </NuqsTestingAdapter>,
  );
}

describe("DocumentDetailTabs (S7 'Detalle')", () => {
  it("shows the PRD tabs in order, with the version and link counts", () => {
    renderTabs("");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Content",
      "Versions3",
      "Links2",
      "Share",
      "Notes",
      "Activity",
      "Graph",
    ]);
    expect(screen.getByText("content slot")).toBeInTheDocument();
  });

  it("names the tabs in Spanish", () => {
    renderTabs("", {}, "es");
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Contenido",
      "Versiones3",
      "Vínculos2",
      "Compartir",
      "Notas",
      "Actividad",
      "Grafo",
    ]);
  });

  it("opens the tab named in ?tab=, including the shares slot", () => {
    renderTabs("?tab=shares");
    expect(screen.getByText("shares slot")).toBeInTheDocument();
    expect(screen.queryByText("content slot")).not.toBeInTheDocument();
  });

  it("leaves the Activity tab out for a role that cannot read the log", () => {
    renderTabs("", { activity: null });
    expect(screen.queryByRole("tab", { name: "Activity" })).not.toBeInTheDocument();
  });

  it("points the Graph tab to the document's graph page (A1)", () => {
    renderTabs("?tab=graph");
    expect(screen.getByRole("link", { name: "Open graph" })).toHaveAttribute(
      "href",
      "/documents/doc_1/graph",
    );
  });
});
