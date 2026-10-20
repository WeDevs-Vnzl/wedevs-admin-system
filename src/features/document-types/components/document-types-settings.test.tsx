import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { installResizeObserver, renderWithIntl } from "@/features/catalogs/components/test-utils";
import {
  createDocumentCategoryAction,
  createDocumentTypeAction,
  deleteDocumentCategoryAction,
  deleteDocumentTypeAction,
  reorderDocumentCategoriesAction,
  setDocumentTypeActiveAction,
  updateDocumentTypeAction,
} from "@/features/document-types/actions";
import type { DocumentCategoryDetailDTO } from "@/lib/validators/document-types";
import { DocumentTypesSettings } from "./document-types-settings";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/features/document-types/actions", () => ({
  createDocumentCategoryAction: vi.fn(),
  updateDocumentCategoryAction: vi.fn(),
  reorderDocumentCategoriesAction: vi.fn(),
  deleteDocumentCategoryAction: vi.fn(),
  createDocumentTypeAction: vi.fn(),
  updateDocumentTypeAction: vi.fn(),
  setDocumentTypeActiveAction: vi.fn(),
  deleteDocumentTypeAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const categories: DocumentCategoryDetailDTO[] = [
  {
    id: "dcat_legal",
    name: "Legal",
    nameEn: "Legal",
    color: "#6d28d9",
    order: 0,
    types: [
      {
        id: "dtyp_nda",
        name: "Acuerdo de confidencialidad",
        nameEn: "Non-disclosure agreement",
        defaultFormat: "ARCHIVO",
        requiresSignature: true,
        hasExpiration: true,
        active: true,
        documentCount: 2,
      },
      {
        id: "dtyp_adenda",
        name: "Adenda",
        nameEn: null,
        defaultFormat: "MARKDOWN",
        requiresSignature: false,
        hasExpiration: false,
        active: false,
        documentCount: 0,
      },
    ],
  },
  { id: "dcat_rrhh", name: "Recursos humanos", nameEn: "HR", color: null, order: 1, types: [] },
];

const ok = { ok: true, data: {} } as never;

beforeAll(installResizeObserver);
beforeEach(() => vi.clearAllMocks());

describe("DocumentTypesSettings", () => {
  it("lists categories in order with their types, capabilities and document counts", () => {
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    const headings = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(headings).toEqual(["Legal", "HR"]);

    const legal = screen.getByRole("region", { name: "Legal" });
    expect(within(legal).getByText("2 types")).toBeInTheDocument();
    const nda = within(legal).getByRole("listitem", { name: "Non-disclosure agreement" });
    expect(within(nda).getByText("File")).toBeInTheDocument();
    expect(within(nda).getByText("Signature")).toBeInTheDocument();
    expect(within(nda).getByText("Expiration")).toBeInTheDocument();
    expect(within(nda).getByText("2 documents")).toBeInTheDocument();
    // English names fall back to the Spanish one.
    const adenda = within(legal).getByRole("listitem", { name: "Adenda" });
    expect(within(adenda).getByText("Markdown")).toBeInTheDocument();
    expect(within(adenda).queryByText("Signature")).toBeNull();
    expect(within(adenda).getByText("Inactive")).toBeInTheDocument();

    const hr = screen.getByRole("region", { name: "HR" });
    expect(within(hr).getByText("No types in this category yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move Legal up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move HR down" })).toBeDisabled();
  });

  it("moves a category down by sending the whole new order", async () => {
    vi.mocked(reorderDocumentCategoriesAction).mockResolvedValue(ok);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Move Legal down" }));
    await waitFor(() =>
      expect(reorderDocumentCategoriesAction).toHaveBeenCalledWith({
        orderedIds: ["dcat_rrhh", "dcat_legal"],
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Order updated");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("creates a category and shows a name conflict on the field", async () => {
    vi.mocked(createDocumentCategoryAction).mockResolvedValueOnce({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "common.errors.CONFLICT",
        fieldErrors: { name: ["catalogs.documentTypes.errors.categoryNameTaken"] },
      },
    } as never);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "New category" }));
    await user.type(screen.getByLabelText("Name"), "legal");
    await user.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("A category with that name already exists")).toBeInTheDocument();

    vi.mocked(createDocumentCategoryAction).mockResolvedValueOnce(ok);
    await user.clear(screen.getByLabelText("Name"));
    await user.type(screen.getByLabelText("Name"), "Compras");
    await user.type(screen.getByLabelText("Colour (optional)"), "#112233");
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createDocumentCategoryAction).toHaveBeenLastCalledWith({
        name: "Compras",
        nameEn: undefined,
        color: "#112233",
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Category created");
  });

  it("adds a type to a category with its capabilities", async () => {
    vi.mocked(createDocumentTypeAction).mockResolvedValue(ok);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Add a type to HR" }));
    expect(screen.getByRole("heading", { name: "New document type" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Name"), "Contrato laboral");
    await user.click(screen.getByRole("switch", { name: "Requires signature" }));
    await user.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createDocumentTypeAction).toHaveBeenCalledWith({
        categoryId: "dcat_rrhh",
        name: "Contrato laboral",
        nameEn: undefined,
        requiresSignature: true,
        hasExpiration: false,
        defaultFormat: "ARCHIVO",
        active: true,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Document type created");
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("edits a type's capabilities by id", async () => {
    vi.mocked(updateDocumentTypeAction).mockResolvedValue(ok);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Edit Non-disclosure agreement" }));
    expect(screen.getByRole("heading", { name: "Edit document type" })).toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Has expiration" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateDocumentTypeAction).toHaveBeenCalledWith({
        id: "dtyp_nda",
        categoryId: "dcat_legal",
        name: "Acuerdo de confidencialidad",
        nameEn: "Non-disclosure agreement",
        requiresSignature: true,
        hasExpiration: false,
        defaultFormat: "ARCHIVO",
        active: true,
      }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Document type updated");
  });

  it("activates a type from its switch", async () => {
    vi.mocked(setDocumentTypeActiveAction).mockResolvedValue(ok);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("switch", { name: "Activate or deactivate Adenda" }));
    await waitFor(() =>
      expect(setDocumentTypeActiveAction).toHaveBeenCalledWith({ id: "dtyp_adenda", active: true }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Document type activated");
  });

  it("offers deactivation instead of delete for a type in use (HU-21 CA2)", async () => {
    vi.mocked(setDocumentTypeActiveAction).mockResolvedValue(ok);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Delete Non-disclosure agreement" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Document type in use")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Deactivate" }));
    await waitFor(() =>
      expect(setDocumentTypeActiveAction).toHaveBeenCalledWith({ id: "dtyp_nda", active: false }),
    );
    expect(deleteDocumentTypeAction).not.toHaveBeenCalled();
  });

  it("deletes an unused type, and turns a server lock into the in-use notice", async () => {
    vi.mocked(deleteDocumentTypeAction).mockResolvedValueOnce({
      ok: false,
      error: { code: "INTEGRITY_LOCK", message: "catalogs.documentTypes.errors.typeInUse" },
    } as never);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Delete Adenda" }));
    let dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteDocumentTypeAction).toHaveBeenCalledWith({ id: "dtyp_adenda" }),
    );
    dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Document type in use")).toBeInTheDocument();
    // Already inactive: nothing to offer but closing the notice.
    expect(within(dialog).queryByRole("button", { name: "Deactivate" })).toBeNull();

    vi.mocked(deleteDocumentTypeAction).mockResolvedValueOnce(ok);
    // The notice shows before the delete transition settles; its button is enabled once it does.
    const close = within(dialog).getByRole("button", { name: "Close" });
    await waitFor(() => expect(close).toBeEnabled());
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    await user.click(screen.getByRole("button", { name: "Delete Adenda" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith("Document type deleted"));
  });

  it("locks the delete of a category with types and deletes an empty one", async () => {
    vi.mocked(deleteDocumentCategoryAction).mockResolvedValue(ok);
    const user = userEvent.setup();
    renderWithIntl(<DocumentTypesSettings categories={categories} />);
    await user.click(screen.getByRole("button", { name: "Delete Legal" }));
    let dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Category with types")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Delete" })).toBeNull();
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "Delete HR" }));
    dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(deleteDocumentCategoryAction).toHaveBeenCalledWith({ id: "dcat_rrhh" }),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith("Category deleted");
  });

  it("shows the empty state without categories", () => {
    renderWithIntl(<DocumentTypesSettings categories={[]} />);
    expect(screen.getByText("No document categories")).toBeInTheDocument();
  });
});
