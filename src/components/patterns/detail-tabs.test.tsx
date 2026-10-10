import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter, type OnUrlUpdateFunction } from "nuqs/adapters/testing";
import { describe, expect, it, vi } from "vitest";
import { DetailTabs } from "./detail-tabs";

const tabs = [
  { value: "notes", label: "Notes", count: 2, content: "Notes content" },
  { value: "documents", label: "Documents", count: 5, content: "Documents content" },
  { value: "activity", label: "Activity", content: "Activity content" },
];

function renderTabs(search: string, onUrlUpdate?: OnUrlUpdateFunction) {
  return render(
    <NuqsTestingAdapter searchParams={search} onUrlUpdate={onUrlUpdate} hasMemory>
      <DetailTabs tabs={tabs} defaultTab="notes" />
    </NuqsTestingAdapter>,
  );
}

describe("DetailTabs", () => {
  it("shows the tab named in ?tab=", () => {
    renderTabs("?tab=documents");
    expect(screen.getByText("Documents content")).toBeInTheDocument();
    expect(screen.queryByText("Notes content")).not.toBeInTheDocument();
  });

  it("falls back to the default tab for a missing or unknown value", () => {
    const { unmount } = renderTabs("");
    expect(screen.getByText("Notes content")).toBeInTheDocument();
    unmount();

    renderTabs("?tab=nope");
    expect(screen.getByText("Notes content")).toBeInTheDocument();
  });

  it("shows the counts next to the labels", () => {
    renderTabs("");
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("writes the selected tab to ?tab= when the user switches tabs", async () => {
    const onUrlUpdate = vi.fn();
    renderTabs("", onUrlUpdate);

    await userEvent.click(screen.getByRole("tab", { name: /Documents/ }));

    expect(screen.getByText("Documents content")).toBeInTheDocument();
    const last = onUrlUpdate.mock.calls.at(-1)?.[0];
    expect(last?.searchParams.get("tab")).toBe("documents");
  });
});
