import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER" }));

vi.mock("server-only", () => ({}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/features/settings/queries", async () => {
  const { can } = await import("@/server/auth/permissions");
  const { makeSessionUser } = await import("@/mocks/test-helpers");
  return {
    // The real access rule of the settings section: `read` on `settings` (Owner and Admin).
    getOpenableSettingsSection: async (slug: string) =>
      can(makeSessionUser(state.role), "read", "settings") ? { slug } : null,
  };
});
vi.mock("@/features/technologies/queries", () => ({
  listTechnologies: async () => ({ items: [], total: 0, page: 1, pageSize: 25, pageCount: 1 }),
  technologyFilterFromParams: () => ({ page: 1, pageSize: 25 }),
}));
vi.mock("@/features/technologies/components/technologies-table", () => ({
  TechnologiesTable: () => <div>table</div>,
}));

import TechnologiesPage from "./page";

async function render(role: typeof state.role) {
  state.role = role;
  return TechnologiesPage({ searchParams: Promise.resolve({}) });
}

describe("/settings/technologies access", () => {
  it.each(["OWNER", "ADMIN"] as const)("renders the catalog for %s", async (role) => {
    await expect(render(role)).resolves.toBeTruthy();
  });

  it.each(["MEMBER", "VIEWER"] as const)("calls notFound() for %s", async (role) => {
    await expect(render(role)).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
