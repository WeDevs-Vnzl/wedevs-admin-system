import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSessionUser: vi.fn(),
  loadProjectOr404: vi.fn(),
  getProject: vi.fn(),
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
vi.mock("@/server/auth/session", () => ({ requireSessionUser: mocks.requireSessionUser }));
vi.mock("@/features/projects/load-project", () => ({ loadProjectOr404: mocks.loadProjectOr404 }));
vi.mock("@/features/projects/queries", () => ({ getProject: mocks.getProject }));
vi.mock("@/features/technologies/queries", () => ({
  listActiveTechnologies: mocks.listActiveTechnologies,
}));
vi.mock("@/features/tags/queries", () => ({ canCreateTagsInline: mocks.canCreateTagsInline }));
vi.mock("@/components/app/breadcrumb-label", () => ({ BreadcrumbLabel: () => null }));
vi.mock("@/features/projects/components/project-form", () => ({ ProjectForm: () => null }));

import { makeSessionUser } from "@/mocks/test-helpers";
import EditProjectPage from "./page";

const project = { id: "pry_1", code: "PRY-0001", name: "Sitio" };
const render = () => EditProjectPage({ params: Promise.resolve({ id: "pry_1" }) });

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.loadProjectOr404.mockResolvedValue(project);
  mocks.listActiveTechnologies.mockResolvedValue([]);
  mocks.canCreateTagsInline.mockResolvedValue(false);
});

describe("/projects/[id]/edit (update is cosmetic here, the BE decides)", () => {
  it.each(["OWNER", "ADMIN", "MEMBER"] as const)("renders the form for %s", async (role) => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser(role));
    const element = await render();
    const form = element.props.children[1];
    expect(form.props).toMatchObject({ mode: "edit", project, backHref: "/projects/pry_1" });
  });

  it("hides the page from a Viewer without loading the project", async () => {
    mocks.requireSessionUser.mockResolvedValue(makeSessionUser("VIEWER"));
    await expect(render()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.loadProjectOr404).not.toHaveBeenCalled();
  });
});
