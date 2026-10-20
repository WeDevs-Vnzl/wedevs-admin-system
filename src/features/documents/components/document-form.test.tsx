import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import enCommon from "@/i18n/messages/en/common.json";
import enDocuments from "@/i18n/messages/en/documents.json";
import enForms from "@/i18n/messages/en/forms.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { DocumentCategoryDetailDTO } from "@/lib/validators/document-types";
import type { DocumentDetailDTO } from "@/lib/validators/documents";

const actions = vi.hoisted(() => ({
  createDocumentAction: vi.fn(),
  updateDocumentMetaAction: vi.fn(),
}));
const router = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/tags/components/tag-picker", () => ({
  TagPicker: () => <div data-testid="tag-picker" />,
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { DocumentForm } from "./document-form";

const messages = {
  common: enCommon,
  documents: enDocuments,
  forms: enForms,
  patterns: enPatterns,
  validation: enValidation,
};

const categories: DocumentCategoryDetailDTO[] = [
  {
    id: "dcat_legal",
    name: "Legal",
    nameEn: "Legal",
    color: null,
    order: 1,
    types: [
      {
        id: "dtyp_contract",
        name: "Contrato",
        nameEn: "Contract",
        defaultFormat: "MARKDOWN",
        requiresSignature: true,
        hasExpiration: true,
        active: true,
        documentCount: 0,
      },
      {
        id: "dtyp_minutes",
        name: "Acta",
        nameEn: "Minutes",
        defaultFormat: "ARCHIVO",
        requiresSignature: false,
        hasExpiration: false,
        active: true,
        documentCount: 0,
      },
      {
        id: "dtyp_old",
        name: "Viejo",
        nameEn: "Old",
        defaultFormat: "ARCHIVO",
        requiresSignature: false,
        hasExpiration: false,
        active: false,
        documentCount: 1,
      },
    ],
  },
];

const clientRef = { type: "CLIENT" as const, id: "cli_0001", code: "CLI-0001", label: "Acme" };

function renderForm(props: Partial<Parameters<typeof DocumentForm>[0]> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <DocumentForm categories={categories} canCreateTags={false} {...props} />
    </NextIntlClientProvider>,
  );
}

async function pickType(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(screen.getByRole("combobox", { name: "Document type" }));
  await user.click(await screen.findByRole("option", { name }));
}

beforeAll(() => {
  // Radix Select needs pointer capture and scrolling, which jsdom does not implement.
  Element.prototype.scrollIntoView ??= () => {};
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
});

beforeEach(() => {
  for (const mock of Object.values(actions)) mock.mockReset();
  router.push.mockReset();
});

describe("DocumentForm, create", () => {
  it("shows the signature and expiry fields only for a type that has them", async () => {
    const user = userEvent.setup();
    renderForm();
    expect(screen.queryByLabelText("Signed date")).not.toBeInTheDocument();
    await pickType(user, "Contract");
    expect(screen.getByText("Signed date")).toBeInTheDocument();
    expect(screen.getByText("Expiry date")).toBeInTheDocument();
    await pickType(user, "Minutes");
    expect(screen.queryByText("Signed date")).not.toBeInTheDocument();
    expect(screen.queryByText("Expiry date")).not.toBeInTheDocument();
  });

  it("offers only active types", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("combobox", { name: "Document type" }));
    expect(await screen.findByRole("option", { name: "Contract" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Old" })).not.toBeInTheDocument();
  });

  it("validates before calling the action", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Create document" }));
    expect(actions.createDocumentAction).not.toHaveBeenCalled();
    expect(await screen.findAllByRole("alert")).not.toHaveLength(0);
  });

  it("creates the document linked to the prefilled record and opens its editor for markdown", async () => {
    const user = userEvent.setup();
    actions.createDocumentAction.mockResolvedValue({ ok: true, data: { id: "doc_9" } });
    renderForm({ initialLinks: [clientRef] });
    expect(screen.getByText("CLI-0001")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Master agreement");
    await pickType(user, "Contract");
    await user.click(screen.getByRole("button", { name: "Create document" }));
    await waitFor(() => expect(actions.createDocumentAction).toHaveBeenCalledTimes(1));
    expect(actions.createDocumentAction).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Master agreement",
        typeId: "dtyp_contract",
        links: [{ entityType: "CLIENT", entityId: "cli_0001" }],
      }),
    );
    expect(router.push).toHaveBeenCalledWith("/documents/doc_9/editor");
  });

  it("drops a prefilled link the user removes, and opens the detail of a file document", async () => {
    const user = userEvent.setup();
    actions.createDocumentAction.mockResolvedValue({ ok: true, data: { id: "doc_10" } });
    renderForm({ initialLinks: [clientRef] });
    await user.click(screen.getByRole("button", { name: "Remove link to Acme" }));
    expect(screen.getByText("Not linked to any record.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Title"), "Kickoff minutes");
    await pickType(user, "Minutes");
    await user.click(screen.getByRole("button", { name: "Create document" }));
    await waitFor(() => expect(actions.createDocumentAction).toHaveBeenCalledTimes(1));
    expect(actions.createDocumentAction.mock.calls[0]![0]).toMatchObject({ links: [] });
    expect(router.push).toHaveBeenCalledWith("/documents/doc_10");
  });

  it("puts the server's field errors on their fields", async () => {
    const user = userEvent.setup();
    actions.createDocumentAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "common.errors.VALIDATION",
        fieldErrors: { title: ["documents.validation.signedAtNotAllowed"] },
      },
    });
    renderForm();
    await user.type(screen.getByLabelText("Title"), "Something");
    await pickType(user, "Minutes");
    await user.click(screen.getByRole("button", { name: "Create document" }));
    expect(await screen.findByText(enDocuments.validation.signedAtNotAllowed)).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("DocumentForm, edit", () => {
  const document = {
    id: "doc_1",
    code: "DOC-0001",
    title: "Old title",
    type: { ...categories[0]!.types[0]!, defaultFormat: "MARKDOWN" },
    category: { id: "dcat_legal", name: "Legal", nameEn: "Legal", color: null },
    summary: "A summary",
    status: "BORRADOR",
    effectiveDate: "2026-01-01",
    signedAt: null,
    expiresAt: "2026-12-31",
    alertDaysBefore: 15,
    tags: [],
    links: [],
  } as unknown as DocumentDetailDTO;

  it("loads the stored metadata and saves it with the document id, without a links section", async () => {
    const user = userEvent.setup();
    actions.updateDocumentMetaAction.mockResolvedValue({ ok: true, data: { id: "doc_1" } });
    renderForm({ document });
    expect(screen.getByLabelText("Title")).toHaveValue("Old title");
    expect(screen.queryByText("Linked to")).not.toBeInTheDocument();
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "New title");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(actions.updateDocumentMetaAction).toHaveBeenCalledTimes(1));
    expect(actions.updateDocumentMetaAction).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "doc_1",
        title: "New title",
        typeId: "dtyp_contract",
        summary: "A summary",
        expiresAt: "2026-12-31",
        alertDaysBefore: 15,
      }),
    );
    expect(actions.createDocumentAction).not.toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith("/documents/doc_1");
  });
});
