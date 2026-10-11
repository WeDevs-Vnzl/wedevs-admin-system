import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enProjects from "@/i18n/messages/en/projects.json";
import enValidation from "@/i18n/messages/en/validation.json";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import type { ProjectLinkRow } from "../link-rows";
import { ProjectLinksEditor } from "./project-links-editor";

const { writeTextSpy } = vi.hoisted(() => ({ writeTextSpy: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const messages = {
  common: enCommon,
  enums: enEnums,
  projects: enProjects,
  validation: enValidation,
};

/** The text of a message key such as `validation.x.y`, read from the English catalogue. */
function textOf(key: string): string {
  return key
    .split(".")
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages) as string;
}

const ROWS: ProjectLinkRow[] = [
  { key: "lnk_a", id: "lnk_a", group: "REPOSITORIO", label: "Frontend", url: "https://github.com/wedevs/front", order: 0 },
  { key: "lnk_b", id: "lnk_b", group: "REPOSITORIO", label: "Backend", url: "https://github.com/wedevs/back", order: 1 },
  { key: "lnk_c", id: "lnk_c", group: "DISENO", label: "Figma", url: "https://www.figma.com/file/x", order: 0 },
];

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
});

/** The editor is controlled: this harness keeps the rows the way the form does and reports every change. */
function Harness({
  initial,
  editable = false,
  reorderable = false,
  onRows,
}: {
  initial: ProjectLinkRow[];
  editable?: boolean;
  reorderable?: boolean;
  onRows: (rows: ProjectLinkRow[]) => void;
}) {
  const [rows, setRows] = useState(initial);
  return (
    <ProjectLinksEditor
      rows={rows}
      editable={editable}
      reorderable={reorderable}
      onChange={(next) => {
        setRows(next);
        onRows(next);
      }}
    />
  );
}

function renderEditor(props: {
  initial: ProjectLinkRow[];
  editable?: boolean;
  reorderable?: boolean;
}) {
  const onRows = vi.fn();
  render(
    <NextIntlClientProvider locale="en" messages={messages} timeZone="America/Caracas">
      <Harness {...props} onRows={onRows} />
    </NextIntlClientProvider>,
  );
  return { onRows };
}

describe("ProjectLinksEditor", () => {
  it("shows the field error on an invalid URL and clears it once the URL is valid (HU-07 CA3)", async () => {
    const user = userEvent.setup();
    renderEditor({
      initial: [{ key: "new-1", group: "REPOSITORIO", label: "Repo", url: "no es una url", order: 0 }],
      editable: true,
      reorderable: true,
    });
    const urlInput = screen.getByLabelText("URL");
    expect(urlInput).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText(textOf(VALIDATION_MESSAGES.invalidFormat))).toBeInTheDocument();

    await user.clear(urlInput);
    await user.type(urlInput, "https://example.com");
    expect(urlInput).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(textOf(VALIDATION_MESSAGES.invalidFormat))).not.toBeInTheDocument();
  });

  it("adds a link to a group (HU-07 CA1) and reports the new row", async () => {
    const user = userEvent.setup();
    const { onRows } = renderEditor({ initial: ROWS, editable: true, reorderable: true });
    await user.click(screen.getByRole("button", { name: "Add link to Repository" }));
    const next = onRows.mock.calls.at(-1)?.[0] as ProjectLinkRow[];
    expect(next.filter((row) => row.group === "REPOSITORIO")).toHaveLength(3);
    expect(next.at(-1)).toMatchObject({ group: "REPOSITORIO", label: "", url: "", order: 2 });
  });

  it("moves a link up inside its group with the arrow button (CA2, keyboard reachable)", async () => {
    const user = userEvent.setup();
    const { onRows } = renderEditor({ initial: ROWS, editable: true, reorderable: true });
    await user.click(screen.getByRole("button", { name: "Move Backend up" }));
    const next = onRows.mock.calls.at(-1)?.[0] as ProjectLinkRow[];
    expect(next.filter((row) => row.group === "REPOSITORIO").map((row) => row.key)).toEqual([
      "lnk_b",
      "lnk_a",
    ]);
    expect(await screen.findByText("Backend moved to position 1 of 2 in Repository.")).toBeInTheDocument();
  });

  it("renders read-only rows for a Viewer: no inputs, no arrows, links open in a new tab", () => {
    renderEditor({ initial: ROWS });
    expect(screen.queryByLabelText("URL")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Move .* up/ })).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Open Frontend in a new tab" });
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("copies a URL to the clipboard", async () => {
    const user = userEvent.setup();
    writeTextSpy.mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: writeTextSpy },
      configurable: true,
    });
    renderEditor({ initial: ROWS });
    await user.click(screen.getByRole("button", { name: "Copy URL of Figma" }));
    expect(writeTextSpy).toHaveBeenCalledWith("https://www.figma.com/file/x");
  });
});
