import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOpenableSettingsSection, getTrash, notFound } = vi.hoisted(() => ({
  getOpenableSettingsSection: vi.fn(),
  getTrash: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/features/settings/queries", () => ({ getOpenableSettingsSection }));
vi.mock("@/features/trash/queries", () => ({ getTrash }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/trash/components/trash-table", () => ({
  TrashTable: ({ initialTotal }: { initialTotal: number }) => <p>table:{initialTotal}</p>,
}));

import { trashFilterSchema } from "@/lib/validators/trash";
import TrashSettingsPage, { generateMetadata } from "./page";

const props = { searchParams: Promise.resolve({ filters: '{"entityType":["PROJECT"]}' }) };

beforeEach(() => {
  vi.clearAllMocks();
  getTrash.mockResolvedValue({ items: [], total: 3, page: 1, pageSize: 25, pageCount: 1 });
});

describe("/settings/trash page", () => {
  it("renders the trash for Owner and Admin with the URL filters", async () => {
    getOpenableSettingsSection.mockResolvedValue({ slug: "trash" });
    render(await TrashSettingsPage(props));
    expect(getOpenableSettingsSection).toHaveBeenCalledWith("trash");
    expect(trashFilterSchema.parse(getTrash.mock.calls[0]![0]).entityType).toEqual(["PROJECT"]);
    expect(screen.getByRole("heading", { name: "page.title" })).toBeInTheDocument();
    expect(screen.getByText("table:3")).toBeInTheDocument();
  });

  it("calls notFound() for roles that cannot open the trash", async () => {
    getOpenableSettingsSection.mockResolvedValue(null);
    await expect(TrashSettingsPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getTrash).not.toHaveBeenCalled();
  });

  it("titles the page through generateMetadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "page.title" });
  });
});
