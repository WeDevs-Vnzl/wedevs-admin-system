import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { canManageTags, getTags, notFound } = vi.hoisted(() => ({
  canManageTags: vi.fn(),
  getTags: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/features/tags/queries", () => ({ canManageTags, getTags }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/features/tags/components/tags-table", () => ({
  TagsTable: ({ initialTotal }: { initialTotal: number }) => <p>table:{initialTotal}</p>,
}));

import TagsSettingsPage, { generateMetadata } from "./page";

beforeEach(() => {
  canManageTags.mockReset();
  getTags.mockReset();
  notFound.mockClear();
  getTags.mockResolvedValue({ items: [], total: 4, page: 1, pageSize: 25, pageCount: 1 });
});

const props = { searchParams: Promise.resolve({}) };

describe("/settings/tags page access", () => {
  it("renders the catalogue for Owner and Admin", async () => {
    canManageTags.mockResolvedValue(true);
    render(await TagsSettingsPage(props));
    expect(screen.getByRole("heading", { name: "page.title" })).toBeInTheDocument();
    expect(screen.getByText("table:4")).toBeInTheDocument();
  });

  it.each([false])("calls notFound() when the user may not manage tags (%s)", async (allowed) => {
    canManageTags.mockResolvedValue(allowed);
    await expect(TagsSettingsPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(getTags).not.toHaveBeenCalled();
  });

  it("titles the page through generateMetadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "page.title" });
  });
});
