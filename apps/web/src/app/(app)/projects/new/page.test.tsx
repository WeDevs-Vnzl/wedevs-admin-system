import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  getClient: vi.fn(),
  listActiveTechnologies: vi.fn(),
  canCreateTagsInline: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("next-intl/server", () => ({ getTranslations: async () => (key: string) => key }));
vi.mock("@/lib/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/features/clients/queries", () => ({ getClient: mocks.getClient }));
vi.mock("@/features/technologies/queries", () => ({
  listActiveTechnologies: mocks.listActiveTechnologies,
}));
vi.mock("@/features/tags/queries", () => ({ canCreateTagsInline: mocks.canCreateTagsInline }));
vi.mock("@/features/projects/components/project-form", () => ({ ProjectForm: () => null }));

import { ServiceError } from "@/lib/service-error";
import { makeSessionUser } from "@/lib/auth/testing";
import NewProjectPage from "./page";

const render = (searchParams: Record<string, string> = {}) =>
  NewProjectPage({ searchParams: Promise.resolve(searchParams) });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.listActiveTechnologies.mockResolvedValue([]);
  mocks.canCreateTagsInline.mockResolvedValue(false);
});

describe("/projects/new (create is cosmetic here, the BE decides)", () => {
  it.each(["MEMBER", "VIEWER"] as const)("hides the page from a %s", async (role) => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser(role));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it.each(["OWNER", "ADMIN"] as const)("renders the form for %s", async (role) => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser(role));
    const element = await render();
    expect(element.props).toMatchObject({ mode: "create", initialClient: null });
  });

  it("prefills the first client from ?clientId= (HU-05 CA3)", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getClient.mockResolvedValue({ id: "cli_1", code: "CLI-0001", tradeName: "Kairos" });
    const element = await render({ clientId: "cli_1" });
    expect(element.props.initialClient).toEqual({
      type: "CLIENT",
      id: "cli_1",
      code: "CLI-0001",
      label: "Kairos",
    });
  });

  it("ignores an unknown or archived client instead of failing", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("ADMIN"));
    mocks.getClient.mockRejectedValue(new ServiceError("NOT_FOUND"));
    const element = await render({ clientId: "cli_nope" });
    expect(element.props.initialClient).toBeNull();
  });
});
