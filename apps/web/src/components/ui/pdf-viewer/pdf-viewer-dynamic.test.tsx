import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enCommon from "@/i18n/messages/en/common.json";

import { PdfViewer } from "./index";

// The dynamic wrapper (`pdf-viewer.tsx`): pdf.js is loaded only when a viewer renders, behind a translated
// fallback. pdf.js itself is mocked; the core is the real one.
const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => pdfjs);

function fakeDocument() {
  const page = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  return { numPages: 2, getPage: vi.fn(async () => page) };
}

function renderWrapper() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <PdfViewer url="/documents/doc_1/versions/dver_1/file" onDownload={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("PdfViewer (dynamic wrapper)", () => {
  beforeEach(() => {
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockReturnValue({
      promise: Promise.resolve(fakeDocument()),
      destroy: vi.fn(async () => undefined),
    });
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the translated loading fallback before the viewer module arrives", () => {
    renderWrapper();
    expect(screen.getByRole("status", { name: "Loading document…" })).toBeInTheDocument();
    expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
  });

  it("then renders the real viewer, which loads the URL with the bundled worker", async () => {
    renderWrapper();
    expect(await screen.findByRole("toolbar", { name: "Viewer controls" })).toBeInTheDocument();
    expect(await screen.findByText("1 / 2")).toBeInTheDocument();
    expect(pdfjs.getDocument).toHaveBeenCalledWith({ url: "/documents/doc_1/versions/dver_1/file" });
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/pdf\.worker\.min\.mjs$/);
  });
});
