import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "OWNER" as "OWNER" | "ADMIN" | "MEMBER" | "VIEWER",
  listDocumentCategories: vi.fn(async () => []),
}));

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
      slug === "document-types" && can(makeSessionUser(state.role), "read", "settings")
        ? { slug }
        : null,
  };
});
vi.mock("@/features/document-types/queries", () => ({
  listDocumentCategories: state.listDocumentCategories,
}));
vi.mock("@/features/document-types/components/document-types-settings", () => ({
  DocumentTypesSettings: () => <div>settings</div>,
}));

import DocumentTypesPage from "./page";

async function render(role: typeof state.role) {
  state.role = role;
  return DocumentTypesPage();
}

describe("/settings/document-types access", () => {
  it.each(["OWNER", "ADMIN"] as const)("renders the categories for %s", async (role) => {
    state.listDocumentCategories.mockClear();
    await expect(render(role)).resolves.toBeTruthy();
    expect(state.listDocumentCategories).toHaveBeenCalledOnce();
  });

  it.each(["MEMBER", "VIEWER"] as const)("calls notFound() for %s", async (role) => {
    state.listDocumentCategories.mockClear();
    await expect(render(role)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(state.listDocumentCategories).not.toHaveBeenCalled();
  });
});
