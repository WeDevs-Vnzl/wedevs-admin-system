import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enForms from "@/i18n/messages/en/forms.json";
import enTags from "@/i18n/messages/en/tags.json";
import type { TagChipDTO } from "@/lib/validators/tags";
import { TagPicker } from "./tag-picker";

const { listTagsAction, createTagAction } = vi.hoisted(() => ({
  listTagsAction: vi.fn(),
  createTagAction: vi.fn(),
}));

vi.mock("@/features/tags/actions", () => ({ listTagsAction, createTagAction }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const CATALOGUE = [
  {
    id: "tag_a",
    name: "Prioritario",
    color: "#dc2626",
    usageCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "tag_b",
    name: "Piloto",
    color: "#db2777",
    usageCount: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  listTagsAction.mockReset();
  createTagAction.mockReset();
  listTagsAction.mockImplementation(async ({ q }: { q?: string }) => ({
    ok: true,
    data: {
      items: CATALOGUE.filter((tag) => tag.name.toLowerCase().includes((q ?? "").toLowerCase())),
      total: CATALOGUE.length,
      page: 1,
      pageSize: 50,
      pageCount: 1,
    },
  }));
});

function renderPicker(props: {
  canCreate?: boolean;
  value?: TagChipDTO[];
  onChange?: (next: TagChipDTO[]) => void;
}) {
  const onChange = props.onChange ?? vi.fn();
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ tags: enTags, forms: enForms, common: enCommon }}
    >
      <TagPicker
        aria-label="Tags"
        value={props.value ?? []}
        onChange={onChange}
        canCreate={props.canCreate}
      />
    </NextIntlClientProvider>,
  );
}

describe("TagPicker", () => {
  it("shows the selected tags as coloured chips", () => {
    renderPicker({ value: [CATALOGUE[0]!] });
    const chip = screen.getByText("Prioritario", { selector: "li" });
    expect(chip).toHaveStyle({ backgroundColor: "rgb(220, 38, 38)" });
  });

  it("offers inline creation for a new name when the user may create tags", async () => {
    renderPicker({ canCreate: true });
    await userEvent.type(screen.getByRole("combobox", { name: "Tags" }), "Nueva");
    expect(await screen.findByRole("option", { name: 'Create "Nueva"' })).toBeInTheDocument();
  });

  it("does not offer inline creation when the user may not create tags", async () => {
    renderPicker({ canCreate: false });
    await userEvent.type(screen.getByRole("combobox", { name: "Tags" }), "Nueva");
    await waitFor(() => expect(listTagsAction).toHaveBeenCalled());
    expect(screen.queryByRole("option", { name: /Create/ })).not.toBeInTheDocument();
  });

  it("creates the tag through the action and adds it to the selection", async () => {
    const created = {
      id: "tag_new",
      name: "Nueva",
      color: "#2563eb",
      usageCount: 0,
      createdAt: "2026-10-10T00:00:00.000Z",
    };
    createTagAction.mockResolvedValue({ ok: true, data: created });
    const onChange = vi.fn();
    renderPicker({ canCreate: true, onChange });

    await userEvent.type(screen.getByRole("combobox", { name: "Tags" }), "Nueva");
    await userEvent.click(await screen.findByRole("option", { name: 'Create "Nueva"' }));

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(createTagAction).toHaveBeenCalledWith({
      name: "Nueva",
      color: expect.stringMatching(/^#[0-9a-f]{6}$/i),
    });
    expect(onChange.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: "tag_new", name: "Nueva", color: "#2563eb" }),
    ]);
  });
});
