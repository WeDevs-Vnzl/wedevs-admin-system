import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import esActivity from "@/i18n/messages/es/activity.json";

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(
    async () => (key: string) => esActivity.stats[key as keyof typeof esActivity.stats],
  ),
}));

import { ActivityStats } from "./activity-stats";

describe("ActivityStats", () => {
  it("shows the three figures with their labels", async () => {
    render(await ActivityStats({ total: 148, today: 12, users: 90 }));
    expect(screen.getByText("148")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("90")).toBeInTheDocument();
    expect(screen.getByText("Acciones de usuarios")).toBeInTheDocument();
  });
});
