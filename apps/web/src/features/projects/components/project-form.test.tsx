import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enProjects from "@/i18n/messages/en/projects.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { ProjectForm } from "./project-form";

const actions = vi.hoisted(() => ({
  createProjectAction: vi.fn(),
  updateProjectAction: vi.fn(),
  upsertProjectLinksAction: vi.fn(),
  removeProjectLinkAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("@/features/projects/actions", () => actions);
vi.mock("@/features/clients/actions", () => ({
  searchClientsAction: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
const editor = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("@/components/ui/rich-text", () => ({
  RichTextEditor: (props: Record<string, unknown>) => {
    editor.props.push(props);
    return <div data-testid="rich-text" />;
  },
  RichTextView: () => null,
}));
vi.mock("@/features/tags/components/tag-picker", () => ({
  TagPicker: () => <div data-testid="tag-picker" />,
}));
vi.mock("@/features/technologies/components/technology-picker", () => ({
  TechnologyPicker: () => <div data-testid="technology-picker" />,
}));
// A stand-in for the kit's combobox: one client option per click, and the per-client role input the form binds.
vi.mock("@/components/ui/async-combobox", () => ({
  AsyncCombobox: (props: {
    id?: string;
    value: { value: string; label: string; description?: string; secondary?: string }[];
    onChange: (next: unknown[]) => void;
    secondaryInput?: { label: string };
  }) => (
    <div>
      <button
        type="button"
        onClick={() =>
          props.onChange([
            ...props.value,
            { value: "cli_kairos", label: "Kairos Studio", description: "CLI-0001", secondary: "" },
          ])
        }
      >
        Add Kairos
      </button>
      {props.value.map((option) => (
        <input
          key={option.value}
          aria-label={props.secondaryInput?.label ?? "role"}
          value={option.secondary ?? ""}
          onChange={(event) =>
            props.onChange(
              props.value.map((item) =>
                item.value === option.value ? { ...item, secondary: event.target.value } : item,
              ),
            )
          }
        />
      ))}
    </div>
  ),
}));

const messages = {
  common: enCommon,
  enums: enEnums,
  forms: enForms,
  patterns: enPatterns,
  projects: enProjects,
  validation: enValidation,
};

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  editor.props.length = 0;
  toast.error.mockReset();
  actions.updateProjectAction.mockReset();
  actions.createProjectAction.mockReset();
  actions.createProjectAction.mockResolvedValue({
    ok: true,
    data: { id: "pry_new", code: "PRY-0007" },
  });
  router.push.mockReset();
  router.refresh.mockReset();
});

function renderCreate() {
  return render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Caracas">
      <ProjectForm
        mode="create"
        technologies={[]}
        canCreateTags={false}
        backHref="/projects/list"
      />
    </NextIntlClientProvider>,
  );
}

describe("ProjectForm (create)", () => {
  it("groups the fields in four sections instead of one card per field", () => {
    renderCreate();

    const general = screen.getByRole("group", { name: "General details" });
    expect(within(general).getByLabelText("Name")).toBeInTheDocument();
    expect(within(general).getByLabelText("Summary")).toBeInTheDocument();
    // Wide content (rich text, links) spans both columns; dates and tags share a row.
    expect(general).toHaveClass("md:col-span-2");
    expect(screen.getByRole("group", { name: "Schedule" })).not.toHaveClass("md:col-span-2");
    expect(screen.getByRole("group", { name: "Classification" })).not.toHaveClass("md:col-span-2");
    expect(screen.getByRole("group", { name: "Stack and links" })).toHaveClass("md:col-span-2");
    // No section repeats the label of a single field as its title.
    expect(screen.queryByText("Name", { selector: "[data-slot=card-title]" })).toBeNull();
  });

  it("marks the optional fields and explains summary, clients and start date", () => {
    renderCreate();

    const marked = screen.getAllByText("(optional)").map((mark) => mark.parentElement?.textContent);
    expect(marked).toEqual([
      "Description (optional)",
      "Start date (optional)",
      "Target delivery (optional)",
      "Tags (optional)",
      "Stack (optional)",
      "Links (optional)",
    ]);
    expect(screen.getByLabelText("Summary")).toHaveAccessibleDescription(
      `${enProjects.form.summaryHint} ${enProjects.form.summaryCounter.replace("{count}", "0").replace("{max}", "280")}`,
    );
    expect(screen.getByRole("button", { name: "More about Clients" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Start date/)).toHaveAccessibleDescription(
      enProjects.form.startDateHint,
    );
  });

  it("has an h1 with the page title", () => {
    renderCreate();
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("requires at least one client before saving (HU-05 CA1)", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.type(screen.getByLabelText("Name"), "Sitio Kairos");
    await user.type(screen.getByLabelText("Summary"), "Resumen corto");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Link at least one client.")).toBeInTheDocument();
    expect(actions.createProjectAction).not.toHaveBeenCalled();
  });

  it("links the name and summary inputs to their FieldError through aria-describedby (m2)", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "Save" }));

    const name = screen.getByLabelText("Name");
    await waitFor(() => expect(name).toHaveAttribute("aria-invalid", "true"));
    const nameError = document.getElementById(name.getAttribute("aria-describedby") ?? "");
    expect(nameError).toHaveAttribute("role", "alert");
    const summary = screen.getByLabelText("Summary");
    const described = (summary.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described).toContain("project-summary-counter");
    expect(
      described.some((id) => document.getElementById(id)?.getAttribute("role") === "alert"),
    ).toBe(true);
  });

  it("counts the summary against the 280-character limit (PRD §8.3)", async () => {
    const user = userEvent.setup();
    renderCreate();
    expect(screen.getByText("0 of 280 characters")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Summary"), "Hola mundo");
    expect(screen.getByText("10 of 280 characters")).toBeInTheDocument();
  });

  it("sends each client with its optional role and navigates to the new project (HU-05 CA2)", async () => {
    const user = userEvent.setup();
    renderCreate();
    await user.click(screen.getByRole("button", { name: "Add Kairos" }));
    await user.type(screen.getByLabelText("Role"), "Contratante");
    await user.type(screen.getByLabelText("Name"), "Sitio Kairos");
    await user.type(screen.getByLabelText("Summary"), "Resumen corto");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(actions.createProjectAction).toHaveBeenCalledTimes(1));
    expect(actions.createProjectAction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Sitio Kairos",
        summary: "Resumen corto",
        clients: [{ clientId: "cli_kairos", role: "Contratante" }],
      }),
    );
    await waitFor(() => expect(router.push).toHaveBeenCalledWith("/projects/pry_new"));
  });
});

async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Add Kairos" }));
  await user.type(screen.getByLabelText("Name"), "Sitio Kairos");
  await user.type(screen.getByLabelText("Summary"), "Resumen corto");
  await user.click(screen.getByRole("button", { name: "Save" }));
}

describe("ProjectForm description (C4)", () => {
  it("disables images in the description editor and offers no upload adapter", () => {
    renderCreate();
    expect(editor.props.at(-1)).toMatchObject({ allowImages: false });
    expect(editor.props.at(-1)).not.toHaveProperty("uploadAdapter");
  });
});

describe("ProjectForm server errors", () => {
  it("shows an inactive technology (422, HU-06 CA1) on the stack field", async () => {
    const user = userEvent.setup();
    actions.createProjectAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { technologyIds: ["projects.errors.technologyInactive"] },
      },
    });
    renderCreate();
    await fillAndSave(user);
    expect(await screen.findByText(enProjects.errors.technologyInactive)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });

  it("toasts a link row error (links.0.url, HU-07 CA3) instead of swallowing it", async () => {
    const user = userEvent.setup();
    actions.createProjectAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { "links.0.url": ["validation.invalidUrl"] },
      },
    });
    renderCreate();
    await fillAndSave(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(enCommon.errors.VALIDATION));
  });

  it("answers a CONFLICT without an entity (DT-177) with the generic message and keeps the form", async () => {
    const user = userEvent.setup();
    actions.createProjectAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "common.errors.CONFLICT" },
    });
    renderCreate();
    await fillAndSave(user);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(enCommon.errors.CONFLICT));
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Name")).toHaveValue("Sitio Kairos");
  });
});
