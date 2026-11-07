import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PaymentReceiptDto } from "@/lib/api/types/payments";
import { PaymentReceipt } from "./payment-receipt";
import { renderWithIntl } from "./test-utils";

vi.mock("@/components/ui/pdf-viewer", () => ({
  PdfViewer: ({ url }: { url: string }) => <div data-testid="pdf-viewer" data-url={url} />,
}));

const base: PaymentReceiptDto = {
  id: "fil_1",
  mimeType: "application/pdf",
  originalName: "comprobante.pdf",
  sizeBytes: 20480,
  status: "READY",
  uploadedById: "usr_1",
  createdAt: "2026-10-05T12:00:00.000Z",
};

describe("PaymentReceipt (HU-14 CA2, rule 25)", () => {
  it("views a PDF receipt in place through the authenticated file route", () => {
    renderWithIntl(<PaymentReceipt receipt={base} />);
    expect(screen.getByTestId("pdf-viewer")).toHaveAttribute("data-url", "/files/fil_1/download");
    expect(screen.getByText("comprobante.pdf")).toBeInTheDocument();
    expect(screen.queryByText(/preview is available/i)).not.toBeInTheDocument();
  });

  it("views an image receipt in an <img> from the same route", () => {
    renderWithIntl(
      <PaymentReceipt
        receipt={{ ...base, id: "fil_2", mimeType: "image/png", originalName: "foto.png" }}
      />,
    );
    const image = screen.getByRole("img", { name: /foto\.png/ });
    expect(image).toHaveAttribute("src", "/files/fil_2/download");
    expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();
  });

  it("offers any other type as a download card", () => {
    renderWithIntl(
      <PaymentReceipt
        receipt={{ ...base, id: "fil_3", mimeType: "text/plain", originalName: "nota.txt" }}
      />,
    );
    expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
      "href",
      "/files/fil_3/download",
    );
    expect(screen.queryByTestId("pdf-viewer")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("says so when the payment has no receipt", () => {
    renderWithIntl(<PaymentReceipt receipt={null} />);
    expect(screen.getByText("This payment has no receipt.")).toBeInTheDocument();
  });
});
