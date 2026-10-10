import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import enCommon from "@/i18n/messages/en/common.json";

import { PdfViewerCore } from "./pdf-viewer-core";

// pdf.js is mocked: the viewer only needs getDocument, a page with a viewport, and a render task.
const pdfjs = vi.hoisted(() => ({
  getDocument: vi.fn(),
  GlobalWorkerOptions: { workerSrc: "" },
}));

vi.mock("pdfjs-dist", () => pdfjs);

type FakePage = {
  getViewport: ReturnType<typeof vi.fn>;
  render: ReturnType<typeof vi.fn>;
};

type FakeDocument = {
  numPages: number;
  getPage: ReturnType<typeof vi.fn>;
  page: FakePage;
};

// pdf.js returns a loading task: `promise` resolves to the document, `destroy` aborts the load.
function loadingTask(promise: Promise<unknown>) {
  return { promise, destroy: vi.fn(async () => undefined) };
}

function makeDocument(numPages: number): FakeDocument {
  const page: FakePage = {
    getViewport: vi.fn(({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
  };
  return {
    numPages,
    page,
    getPage: vi.fn(async () => page),
  };
}

function renderViewer(onDownload = vi.fn()) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common: enCommon }}>
      <PdfViewerCore url="/documents/sample.pdf" onDownload={onDownload} />
    </NextIntlClientProvider>,
  );
}

const button = (name: string) => screen.getByRole("button", { name });

describe("PdfViewerCore", () => {
  let doc: FakeDocument;

  beforeEach(() => {
    doc = makeDocument(3);
    pdfjs.getDocument.mockReset();
    pdfjs.getDocument.mockReturnValue(loadingTask(Promise.resolve(doc)));
    // jsdom has no 2D canvas; the render path only needs a truthy context.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
      {} as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows a loading state, then the first page of three", async () => {
    renderViewer();
    expect(screen.getByRole("status", { name: "Loading document…" })).toBeInTheDocument();
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
    expect(pdfjs.GlobalWorkerOptions.workerSrc).toMatch(/pdf\.worker\.min\.mjs/);
    expect(pdfjs.getDocument).toHaveBeenCalledWith({ url: "/documents/sample.pdf" });
  });

  it("keeps previous/next within the page bounds", async () => {
    const user = userEvent.setup();
    renderViewer();
    await screen.findByText("1 / 3");

    expect(button("Previous page")).toBeDisabled();
    await user.click(button("Next page"));
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
    await user.click(button("Next page"));
    expect(await screen.findByText("3 / 3")).toBeInTheDocument();

    expect(button("Next page")).toBeDisabled();
    await user.click(button("Previous page"));
    expect(await screen.findByText("2 / 3")).toBeInTheDocument();
  });

  it("steps the zoom and disables the buttons at the limits", async () => {
    const user = userEvent.setup();
    renderViewer();
    await screen.findByText("1 / 3");

    expect(button("Reset zoom to 100 %")).toHaveTextContent("100 %");
    await user.click(button("Zoom in"));
    expect(button("Reset zoom to 100 %")).toHaveTextContent("125 %");
    await user.click(button("Zoom out"));
    await user.click(button("Zoom out"));
    expect(button("Reset zoom to 100 %")).toHaveTextContent("75 %");

    await user.click(button("Reset zoom to 100 %"));
    expect(button("Reset zoom to 100 %")).toHaveTextContent("100 %");

    for (let step = 0; step < 10; step++) {
      await user.click(button("Zoom in"));
    }
    expect(button("Reset zoom to 100 %")).toHaveTextContent("300 %");
    expect(button("Zoom in")).toBeDisabled();

    for (let step = 0; step < 10; step++) {
      await user.click(button("Zoom out"));
    }
    expect(button("Reset zoom to 100 %")).toHaveTextContent("50 %");
    expect(button("Zoom out")).toBeDisabled();
  });

  it("renders the current page again after a zoom change", async () => {
    const user = userEvent.setup();
    renderViewer();
    await screen.findByText("1 / 3");
    await waitFor(() => expect(doc.page.render).toHaveBeenCalled());

    const callsBefore = doc.page.render.mock.calls.length;
    await user.click(button("Zoom in"));
    await waitFor(() => expect(doc.page.render.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it("calls onDownload and never builds a URL itself", async () => {
    const user = userEvent.setup();
    const onDownload = vi.fn();
    renderViewer(onDownload);
    await screen.findByText("1 / 3");

    await user.click(button("Download"));
    expect(onDownload).toHaveBeenCalledTimes(1);
    expect(pdfjs.getDocument).toHaveBeenCalledTimes(1);
  });

  it("shows an error state and retries the load", async () => {
    const user = userEvent.setup();
    pdfjs.getDocument.mockReturnValueOnce(loadingTask(Promise.reject(new Error("network"))));
    renderViewer();

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The document could not be displayed",
    );
    await user.click(button("Retry"));
    expect(await screen.findByText("1 / 3")).toBeInTheDocument();
    expect(pdfjs.getDocument).toHaveBeenCalledTimes(2);
  });

  it("disables page and zoom controls while the document is loading", () => {
    pdfjs.getDocument.mockReturnValueOnce(loadingTask(new Promise(() => undefined)));
    renderViewer();
    expect(button("Next page")).toBeDisabled();
    expect(button("Zoom in")).toBeDisabled();
    // Download stays available so the viewer never hides the file's own action.
    expect(button("Download")).toBeEnabled();
  });

  it("exposes the fullscreen toggle with its pressed state", async () => {
    renderViewer();
    await screen.findByText("1 / 3");
    // Entering fullscreen needs the Fullscreen API, which jsdom does not implement; only the state is checked here.
    expect(button("Full screen")).toHaveAttribute("aria-pressed", "false");
  });
});
