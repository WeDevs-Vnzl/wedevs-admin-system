import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PaymentDetailHeader } from "./payment-detail-header";
import { renderWithIntl } from "./test-utils";

const payment = {
  id: "pag_1",
  code: "PAG-0001",
  status: "CONFIRMADO" as const,
  description: "Kairos Studio · Transferencia",
};

describe("PaymentDetailHeader", () => {
  it("shows the payment code, the client and method line and the status", () => {
    renderWithIntl(<PaymentDetailHeader payment={payment} />);

    expect(screen.getByRole("heading", { level: 1, name: "PAG-0001" })).toBeInTheDocument();
    expect(screen.getByText("Kairos Studio · Transferencia")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
  });

  it('offers the shared "Detail | Graph" toggle on Detail (A4)', () => {
    renderWithIntl(<PaymentDetailHeader payment={payment} />);

    expect(screen.getByRole("radiogroup", { name: "View" })).toBeInTheDocument();
    expect(screen.getByText("Detail").closest("a")).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Graph").closest("a")).toHaveAttribute("href", "/payments/pag_1/graph");
  });
});
