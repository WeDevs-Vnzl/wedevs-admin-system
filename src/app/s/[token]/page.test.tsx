import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queries = vi.hoisted(() => ({ loadPortalPage: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/features/portal/queries", () => queries);
vi.mock("@/features/portal/components/portal-view", () => ({ PortalView: () => null }));

import NotFound from "./not-found";
import PortalPage, { metadata } from "./page";

const TOKEN = "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s";
const props = (token: string) => ({ params: Promise.resolve({ token }) });

beforeEach(() => {
  queries.loadPortalPage.mockReset();
});

describe("/s/[token]", () => {
  it("renders the portal of a live link", async () => {
    const page = { title: "Entrega", documents: [] };
    queries.loadPortalPage.mockResolvedValue(page);
    const element = await PortalPage(props(TOKEN));
    expect(element.props).toEqual({ token: TOKEN, page });
    expect(queries.loadPortalPage).toHaveBeenCalledWith(TOKEN);
  });

  it("answers the generic 404 when the link is unknown, revoked or expired", async () => {
    queries.loadPortalPage.mockResolvedValue(null);
    await expect(PortalPage(props(TOKEN))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("asks search engines not to index or follow it", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
  });
});

describe("/s/[token] not found", () => {
  it("says the link is not available in both languages, without a reason", () => {
    render(<NotFound />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Enlace no disponible" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Link not available")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/revoc|expir|venci|caduc/i);
  });
});
