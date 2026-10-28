import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createExpenseCategoryAction,
  updateExpenseCategoryAction,
} from "@/features/catalogs/actions";
import type { ExpenseCategoryTreeNode } from "@/lib/validators/catalogs";
import { ExpenseCategoriesTree } from "./expense-categories-tree";
import { installResizeObserver, renderWithIntl } from "./test-utils";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/catalogs/actions", () => ({
  createExpenseCategoryAction: vi.fn(),
  updateExpenseCategoryAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const roots: ExpenseCategoryTreeNode[] = [
  {
    id: "cat_ops",
    name: "Operación",
    nameEn: "Operations",
    color: "#336699",
    parentId: null,
    active: true,
    children: [
      {
        id: "cat_hosting",
        name: "Hosting",
        nameEn: null,
        color: null,
        parentId: "cat_ops",
        active: true,
      },
    ],
  },
  {
    id: "cat_tax",
    name: "Impuestos",
    nameEn: "Taxes",
    color: null,
    parentId: null,
    active: false,
    children: [],
  },
];

beforeAll(installResizeObserver);
beforeEach(() => vi.clearAllMocks());

describe("ExpenseCategoriesTree", () => {
  it("shows the two-level tree with English names and the subcategory count", () => {
    renderWithIntl(<ExpenseCategoriesTree roots={roots} />);
    expect(screen.getByText("Operations")).toBeInTheDocument();
    expect(screen.getByText("Hosting")).toBeInTheDocument();
    expect(screen.getByText("1 subcategory")).toBeInTheDocument();
    expect(screen.getByText("No subcategories")).toBeInTheDocument();
    // Subcategories cannot hold subcategories.
    expect(screen.queryByRole("button", { name: "Add a subcategory to Hosting" })).toBeNull();
  });

  it("creates a subcategory under its root", async () => {
    vi.mocked(createExpenseCategoryAction).mockResolvedValue({ ok: true, data: {} } as never);
    const user = userEvent.setup();
    renderWithIntl(<ExpenseCategoriesTree roots={roots} />);
    await user.click(screen.getByRole("button", { name: "Add a subcategory to Operations" }));
    expect(screen.getByRole("heading", { name: "New subcategory" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Dominios");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createExpenseCategoryAction).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Dominios", parentId: "cat_ops", active: true }),
      ),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Category created");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("keeps a category with subcategories as a root when editing", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ExpenseCategoriesTree roots={roots} />);
    await user.click(screen.getByRole("button", { name: "Edit Operations" }));
    expect(screen.getByLabelText("Parent category")).toBeDisabled();
  });

  it("activates a category from its switch", async () => {
    vi.mocked(updateExpenseCategoryAction).mockResolvedValue({ ok: true, data: {} } as never);
    const user = userEvent.setup();
    renderWithIntl(<ExpenseCategoriesTree roots={roots} />);
    await user.click(screen.getByRole("switch", { name: "Activate or deactivate Taxes" }));
    await waitFor(() =>
      expect(updateExpenseCategoryAction).toHaveBeenCalledWith({
        id: "cat_tax",
        name: "Impuestos",
        nameEn: "Taxes",
        color: null,
        parentId: null,
        active: true,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Category activated");
  });
});
