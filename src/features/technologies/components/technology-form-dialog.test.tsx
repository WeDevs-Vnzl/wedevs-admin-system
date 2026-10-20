import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCatalogs from "@/i18n/messages/en/catalogs.json";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { TechnologyListRowDTO } from "@/lib/validators/technologies";
import {
  createTechnologyAction,
  resolveTechnologyIconAction,
  updateTechnologyAction,
} from "@/features/technologies/actions";
import { TechnologyFormDialog } from "./technology-form-dialog";

const mocks = vi.hoisted(() => ({ toast: { success: vi.fn(), error: vi.fn() } }));

vi.mock("@/features/technologies/actions", () => ({
  createTechnologyAction: vi.fn(),
  updateTechnologyAction: vi.fn(),
  setTechnologyActiveAction: vi.fn(),
  deleteTechnologyAction: vi.fn(),
  resolveTechnologyIconAction: vi.fn(),
  exportTechnologiesCsvAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));

const nextJs: TechnologyListRowDTO = {
  id: "tec_next_js",
  name: "Next.js",
  nameEn: null,
  slug: "next-js",
  category: "FRONTEND",
  iconSlug: "nextdotjs",
  color: null,
  active: true,
  usageCount: 2,
};

function renderDialog(
  target: Parameters<typeof TechnologyFormDialog>[0]["target"],
  onSaved = vi.fn(),
) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{
        catalogs: enCatalogs,
        enums: enEnums,
        common: enCommon,
        validation: enValidation,
      }}
    >
      <TechnologyFormDialog target={target} onOpenChange={vi.fn()} onSaved={onSaved} />
    </NextIntlClientProvider>,
  );
}

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(resolveTechnologyIconAction).mockResolvedValue({ ok: true, data: null } as never);
});

describe("TechnologyFormDialog", () => {
  it("derives the slug preview from the name and creates the technology", async () => {
    vi.mocked(createTechnologyAction).mockResolvedValue({ ok: true, data: {} } as never);
    const onSaved = vi.fn();
    renderDialog({ mode: "create" }, onSaved);

    await userEvent.type(screen.getByLabelText("Name"), "Odin Lang");
    expect(screen.getByLabelText("Identifier")).toHaveValue("odin-lang");

    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() =>
      expect(createTechnologyAction).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Odin Lang", category: "OTRO", active: true }),
      ),
    );
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("puts a CONFLICT on the name field and keeps the dialog open", async () => {
    vi.mocked(createTechnologyAction).mockResolvedValue({
      ok: false,
      error: {
        code: "CONFLICT",
        message: "common.errors.CONFLICT",
        fieldErrors: { name: ["catalogs.technologies.errors.nameTaken"] },
      },
    } as never);
    const onSaved = vi.fn();
    renderDialog({ mode: "create" }, onSaved);

    await userEvent.type(screen.getByLabelText("Name"), "next.js");
    await userEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(
      await screen.findByText("A technology with that name already exists"),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the identifier of an edited technology when its name changes", async () => {
    vi.mocked(updateTechnologyAction).mockResolvedValue({ ok: true, data: {} } as never);
    renderDialog({ mode: "edit", technology: nextJs });

    expect(screen.getByLabelText("Identifier")).toHaveValue("next-js");
    await userEvent.clear(screen.getByLabelText("Name"));
    await userEvent.type(screen.getByLabelText("Name"), "Next");
    expect(screen.getByLabelText("Identifier")).toHaveValue("next-js");

    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateTechnologyAction).toHaveBeenCalledWith(
        expect.objectContaining({ id: "tec_next_js", name: "Next", slug: "next-js" }),
      ),
    );
  });
});
