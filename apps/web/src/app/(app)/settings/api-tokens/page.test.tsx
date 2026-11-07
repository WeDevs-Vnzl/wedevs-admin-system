import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiTokens } = vi.hoisted(() => ({ getApiTokens: vi.fn() }));

vi.mock("@/features/api-tokens/queries", () => ({ getApiTokens }));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/features/api-tokens/components/api-tokens-view", () => ({
  ApiTokensView: ({ initialTokens }: { initialTokens: unknown[] }) => (
    <p>view:{initialTokens.length}</p>
  ),
}));

import ApiTokensPage, { generateMetadata } from "./page";

beforeEach(() => {
  getApiTokens.mockReset();
  getApiTokens.mockResolvedValue([{ id: "tok_1" }, { id: "tok_2" }]);
});

describe("/settings/api-tokens page", () => {
  it("renders the caller's tokens with no role check (a Viewer reaches it)", async () => {
    render(await ApiTokensPage());
    expect(screen.getByText("view:2")).toBeInTheDocument();
  });

  it("titles the page through generateMetadata", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "page.title" });
  });
});
