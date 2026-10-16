import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { beforeEach, describe, expect, it, vi } from "vitest";
import enDocuments from "@/i18n/messages/en/documents.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enForms from "@/i18n/messages/en/forms.json";
import enValidation from "@/i18n/messages/en/validation.json";
import esDocuments from "@/i18n/messages/es/documents.json";
import esEnums from "@/i18n/messages/es/enums.json";
import esForms from "@/i18n/messages/es/forms.json";
import esValidation from "@/i18n/messages/es/validation.json";
import type { DocumentStatus } from "@/lib/validators/enums";
import { DocumentStatusDialog } from "./document-status-dialog";
import { allowedDocumentStatuses } from "./document-status-transitions";

const actions = vi.hoisted(() => ({ setDocumentStatusAction: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("../actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("sonner", () => ({ toast }));
// The calendar popover is the date field's own concern; a plain input stands in for it here.
vi.mock("@/components/ui/date-field", () => ({
  DateField: ({
    id,
    value,
    onChange,
    ...aria
  }: {
    id?: string;
    value: string;
    onChange: (value: string) => void;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => (
    <input
      id={id}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-invalid={aria["aria-invalid"]}
      aria-describedby={aria["aria-describedby"]}
    />
  ),
}));

function renderDialog(
  status: DocumentStatus,
  requiresSignature: boolean,
  locale: "en" | "es" = "en",
) {
  const messages =
    locale === "en"
      ? { documents: enDocuments, enums: enEnums, forms: enForms, validation: enValidation }
      : { documents: esDocuments, enums: esEnums, forms: esForms, validation: esValidation };
  const onOpenChange = vi.fn();
  render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <DocumentStatusDialog
        open
        onOpenChange={onOpenChange}
        document={{ id: "doc_0001", status, requiresSignature }}
      />
    </NextIntlClientProvider>,
  );
  return { onOpenChange };
}

beforeEach(() => {
  // Radix radios measure themselves with ResizeObserver, which jsdom does not provide.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  actions.setDocumentStatusAction.mockReset();
  router.refresh.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("allowedDocumentStatuses (S6)", () => {
  it("follows the PRD table and offers FIRMADO only on types with signature", () => {
    expect(allowedDocumentStatuses("BORRADOR", false)).toEqual(["EN_REVISION", "ANULADO"]);
    expect(allowedDocumentStatuses("EN_REVISION", false)).toEqual([
      "BORRADOR",
      "APROBADO",
      "ANULADO",
    ]);
    expect(allowedDocumentStatuses("APROBADO", true)).toEqual(["ENVIADO", "ANULADO"]);
    expect(allowedDocumentStatuses("ENVIADO", false)).toEqual(["ANULADO"]);
    expect(allowedDocumentStatuses("ENVIADO", true)).toEqual(["FIRMADO", "ANULADO"]);
    expect(allowedDocumentStatuses("FIRMADO", true)).toEqual(["ANULADO"]);
    expect(allowedDocumentStatuses("VENCIDO", true)).toEqual([]);
    expect(allowedDocumentStatuses("ANULADO", true)).toEqual([]);
  });
});

describe("DocumentStatusDialog", () => {
  it("offers only the allowed statuses", () => {
    renderDialog("ENVIADO", false);
    const options = screen.getAllByRole("radio").map((radio) => radio.getAttribute("value"));
    expect(options).toEqual(["ANULADO"]);
    expect(screen.queryByRole("radio", { name: "Signed" })).not.toBeInTheDocument();
  });

  it("asks for the signature date when FIRMADO is chosen and refuses to submit without it", async () => {
    const user = userEvent.setup();
    renderDialog("ENVIADO", true);
    expect(screen.queryByLabelText("Signed date")).not.toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: "Signed" }));
    expect(screen.getByLabelText("Signed date")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change status" }));

    expect(await screen.findByText("Required field")).toBeInTheDocument();
    expect(actions.setDocumentStatusAction).not.toHaveBeenCalled();
  });

  it("sends FIRMADO with its signature date, then closes and refreshes", async () => {
    const user = userEvent.setup();
    actions.setDocumentStatusAction.mockResolvedValue({ ok: true, data: {} });
    const { onOpenChange } = renderDialog("ENVIADO", true);

    await user.click(screen.getByRole("radio", { name: "Signed" }));
    await user.type(screen.getByLabelText("Signed date"), "2026-10-08");
    await user.click(screen.getByRole("button", { name: "Change status" }));

    await waitFor(() =>
      expect(actions.setDocumentStatusAction).toHaveBeenCalledWith({
        id: "doc_0001",
        status: "FIRMADO",
        signedAt: "2026-10-08",
      }),
    );
    expect(toast.success).toHaveBeenCalledWith("Status changed");
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("sends a plain transition without a signature date", async () => {
    const user = userEvent.setup();
    actions.setDocumentStatusAction.mockResolvedValue({ ok: true, data: {} });
    renderDialog("BORRADOR", false);
    await user.click(screen.getByRole("radio", { name: "In review" }));
    await user.click(screen.getByRole("button", { name: "Change status" }));
    await waitFor(() =>
      expect(actions.setDocumentStatusAction).toHaveBeenCalledWith({
        id: "doc_0001",
        status: "EN_REVISION",
      }),
    );
  });

  it("shows the server's invalid-transition message on the status field, in Spanish too", async () => {
    const user = userEvent.setup();
    actions.setDocumentStatusAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION",
        message: "errors.validation",
        fieldErrors: { status: ["documents.errors.invalidTransition"] },
      },
    });
    const { onOpenChange } = renderDialog("BORRADOR", false, "es");
    await user.click(screen.getByRole("radio", { name: "En revisión" }));
    await user.click(screen.getByRole("button", { name: "Cambiar estado" }));

    expect(
      await screen.findByText("El documento no puede pasar de su estado actual al estado elegido"),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
