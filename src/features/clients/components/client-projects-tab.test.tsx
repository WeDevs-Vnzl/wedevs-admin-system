import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/projects/queries", () => ({
  listProjects: vi.fn(async () => ({ items: [] })),
}));
// The mini table is replaced by a probe of its "+ Nuevo" link: the test covers what the tab passes to it.
vi.mock("@/components/patterns/related-mini-table", () => ({
  RelatedMiniTable: ({ newHref }: { newHref?: string }) => (
    <div data-testid="projects-table" data-new-href={newHref ?? ""} />
  ),
}));

import { ClientProjectsTab } from "./client-projects-tab";

describe("ClientProjectsTab", () => {
  it("links '+ Nuevo' to a project pre-linked to the client when the viewer may create projects", async () => {
    render(await ClientProjectsTab({ clientId: "cli_kairos", canCreate: true }));
    expect(screen.getByTestId("projects-table")).toHaveAttribute(
      "data-new-href",
      "/projects/new?clientId=cli_kairos",
    );
  });

  it("omits '+ Nuevo' for a viewer without the create-project grant (F2)", async () => {
    render(await ClientProjectsTab({ clientId: "cli_kairos", canCreate: false }));
    expect(screen.getByTestId("projects-table")).toHaveAttribute("data-new-href", "");
  });
});
