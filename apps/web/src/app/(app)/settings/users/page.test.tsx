import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOpenableSettingsSection, getUsers, notFound } = vi.hoisted(() => ({
  getOpenableSettingsSection: vi.fn(),
  getUsers: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/features/settings/queries", () => ({ getOpenableSettingsSection }));
vi.mock("@/features/users/queries", () => ({ getUsers }));
vi.mock("next/navigation", () => ({ notFound }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/users/components/users-table", () => ({
  UsersTable: ({ initialTotal }: { initialTotal: number }) => <p>table:{initialTotal}</p>,
}));

import UsersSettingsPage, { generateMetadata } from "./page";

const props = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  vi.clearAllMocks();
  getUsers.mockResolvedValue({ items: [], total: 5, page: 1, pageSize: 25, pageCount: 1 });
});

describe("/settings/users page (HU-02 CA1: only the Owner sees it)", () => {
  it("renders the users list for the Owner", async () => {
    getOpenableSettingsSection.mockResolvedValue({ slug: "users" });
    render(await UsersSettingsPage(props));
    expect(getOpenableSettingsSection).toHaveBeenCalledWith("users");
    expect(screen.getByRole("heading", { name: "page.title" })).toBeInTheDocument();
    expect(screen.getByText("table:5")).toBeInTheDocument();
  });

  it("calls notFound() for any other role", async () => {
    getOpenableSettingsSection.mockResolvedValue(null);
    await expect(UsersSettingsPage(props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getUsers).not.toHaveBeenCalled();
  });

  it("titles the page through generateMetadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "page.title" });
  });
});
