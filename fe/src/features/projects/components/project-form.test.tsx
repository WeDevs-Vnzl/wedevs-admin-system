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
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/features/files/upload-adapter", () => ({ uploadAdapter: {} }));
vi.mock("@/components/ui/rich-text", () => ({
  RichTextEditor: () => <div data-testid="rich-text" />,
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
  actions.createProjectAction.mockReset();
  actions.createProjectAction.mockResolvedValue({ ok: true, data: { id: "pry_new", code: "PRY-0007" } });
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
    expect(screen.getByRole("group", { name: "Schedule" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Stack and links" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Classification" })).toBeInTheDocument();
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
      "Stack (optional)",
      "Links (optional)",
      "Tags (optional)",
    ]);
    expect(screen.getByLabelText("Summary")).toHaveAccessibleDescription(
      `${enProjects.form.summaryHint} ${enProjects.form.summaryCounter.replace("{count}", "0").replace("{max}", "280")}`,
    );
    expect(screen.getByRole("button", { name: "More about Clients" })).toBeInTheDocument();
    expect(screen.getByLabelText(/^Start date/)).toHaveAccessibleDescription(enProjects.form.startDateHint);
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
    expect(described.some((id) => document.getElementById(id)?.getAttribute("role") === "alert")).toBe(true);
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
