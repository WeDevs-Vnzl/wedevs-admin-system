import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enTable from "@/i18n/messages/en/table.json";
import enTrash from "@/i18n/messages/en/trash.json";
import type { TrashRowDTO } from "@/lib/validators/trash";

const mocks = vi.hoisted(() => ({
  listTrashAction: vi.fn(),
  restoreFromTrashAction: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("../actions", () => ({
  listTrashAction: mocks.listTrashAction,
  restoreFromTrashAction: mocks.restoreFromTrashAction,
}));
vi.mock("@/features/preferences/actions", () => ({ setPreferenceAction: vi.fn() }));
vi.mock("sonner", () => ({ toast: mocks.toast }));

import { TrashTable } from "./trash-table";

const project: TrashRowDTO = {
  entity: {
    id: "pry_veredas_landing",
    type: "PROJECT",
    code: "PRY-0007",
    label: "Landing Veredas",
  },
  context: "Veredas Digital",
  deletedAt: "2026-10-01T12:00:00.000Z",
  deletedBy: { id: "usr_camila_torres", name: "Camila Torres", imageUrl: null },
};
const contact: TrashRowDTO = {
  entity: { id: "con_veredas_digital_1", type: "CONTACT", label: "Luis Rivas" },
  context: "Veredas Digital",
  deletedAt: "2026-09-20T12:00:00.000Z",
  deletedBy: null,
};

function renderTable() {
  return render(
    <NextIntlClientProvider
      locale="en"
      timeZone="America/Caracas"
      messages={{
        common: enCommon,
        enums: enEnums,
        patterns: enPatterns,
        table: enTable,
        trash: enTrash,
      }}
    >
      <NuqsTestingAdapter>
        <TrashTable initialRows={[project, contact]} initialTotal={2} />
      </NuqsTestingAdapter>
    </NextIntlClientProvider>,
  );
}

const rowOf = (label: string) => screen.getByText(label).closest("tr")!;

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listTrashAction.mockResolvedValue({
    ok: true,
    data: { items: [contact], total: 1, page: 1, pageSize: 25, pageCount: 1 },
  });
});

describe("TrashTable (PRD §7.7)", () => {
  it("lists each archived record with its type, context and who archived it", () => {
    renderTable();
    const row = rowOf("Landing Veredas");
    expect(row).toHaveTextContent("Project");
    expect(row).toHaveTextContent("PRY-0007");
    expect(row).toHaveTextContent("Veredas Digital");
    expect(row).toHaveTextContent("Camila Torres");
    expect(rowOf("Luis Rivas")).toHaveTextContent("Contact");
    expect(mocks.listTrashAction).not.toHaveBeenCalled();
  });

  it("offers a type filter and a deletion date filter", () => {
    renderTable();
    expect(screen.getByRole("button", { name: "Type" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Archived on" })).toBeInTheDocument();
  });

  it("restores a record (HU-28 CA2): calls the action and takes it off the list", async () => {
    const user = userEvent.setup();
    mocks.restoreFromTrashAction.mockResolvedValue({
      ok: true,
      data: { entity: project.entity, restoredAt: "2026-10-19T12:00:00.000Z" },
    });
    renderTable();
    await user.click(
      within(rowOf("Landing Veredas")).getByRole("button", { name: "Restore Landing Veredas" }),
    );
    expect(mocks.restoreFromTrashAction).toHaveBeenCalledWith({
      entityType: "PROJECT",
      entityId: "pry_veredas_landing",
    });
    await waitFor(() => expect(screen.queryByText("Landing Veredas")).not.toBeInTheDocument());
    expect(mocks.toast.success).toHaveBeenCalledWith("Landing Veredas restored");
  });

  it("shows the trash message of a CONFLICT and keeps the row", async () => {
    const user = userEvent.setup();
    mocks.restoreFromTrashAction.mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "trash.errors.clientArchived" },
    });
    renderTable();
    await user.click(
      within(rowOf("Luis Rivas")).getByRole("button", { name: "Restore Luis Rivas" }),
    );
    await waitFor(() =>
      expect(mocks.toast.error).toHaveBeenCalledWith(enTrash.errors.clientArchived),
    );
    expect(screen.getByText("Luis Rivas")).toBeInTheDocument();
  });

  it("maps every trash CONFLICT key to a message", () => {
    expect(Object.keys(enTrash.errors).sort()).toEqual(
      ["clientArchived", "invoiceNumberTaken", "taxIdTaken"].sort(),
    );
  });
});
