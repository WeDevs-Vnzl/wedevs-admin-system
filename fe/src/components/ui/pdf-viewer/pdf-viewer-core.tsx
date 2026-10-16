"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { PDFDocumentLoadingTask, PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize,
  Minimize,
  RotateCcw,
  TriangleAlert,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import {
  canGoNext,
  canGoPrevious,
  canZoomIn,
  canZoomOut,
  clampPage,
  DEFAULT_ZOOM,
  zoomIn,
  zoomOut,
  zoomPercent,
} from "./zoom";

// Worker served from the app origin (DT-62, CSP `worker-src 'self'`). Turbopack and webpack resolve this
// static URL at build time, so the worker is emitted as an asset of the app.
const WORKER_SRC = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();

// Horizontal padding kept inside the canvas container, in pixels.
const PAGE_GUTTER = 32;
// Used before the container has been measured (first paint, or jsdom).
const FALLBACK_WIDTH = 600;

export type PdfViewerCoreProps = {
  url: string;
  onDownload: () => void;
  className?: string;
};

// The result of one load attempt. It is tagged with the URL and retry count it was started for, so a
// result from a previous URL can never be shown for the current one.
type LoadResult = { key: string; doc: PDFDocumentProxy | null; failed: boolean };

export function PdfViewerCore({ url, onDownload, className }: PdfViewerCoreProps) {
  const t = useTranslations("common.pdfViewer");
  const tCommon = useTranslations("common");

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<LoadResult | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [width, setWidth] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);

  const loadKey = `${url}#${attempt}`;
  const current = result?.key === loadKey ? result : null;
  const doc = current?.doc ?? null;
  const status = !current ? "loading" : current.failed ? "error" : "ready";

  const pageCount = doc?.numPages ?? 0;
  const currentPage = clampPage(page, pageCount);

  // Load the document whenever the URL changes (or a retry is requested). A stale load is destroyed.
  useEffect(() => {
    let cancelled = false;
    let task: PDFDocumentLoadingTask | null = null;

    async function load() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = WORKER_SRC;
        task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setPage(1);
        setResult({ key: loadKey, doc: loaded, failed: false });
      } catch {
        if (!cancelled) setResult({ key: loadKey, doc: null, failed: true });
      }
    }

    void load();

    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url, attempt, loadKey]);

  // Track the container width so the page fits it at 100 %.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(node.clientWidth);
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Render the current page. A render still in flight is cancelled when the page, zoom or width changes.
  useEffect(() => {
    if (!doc || currentPage < 1) return;
    const pdf = doc;
    let cancelled = false;
    let task: RenderTask | null = null;

    async function render() {
      const pdfPage = await pdf.getPage(currentPage);
      const canvas = canvasRef.current;
      const context = canvas?.getContext("2d");
      if (cancelled || !canvas || !context) return;

      const unit = pdfPage.getViewport({ scale: 1 });
      const available = (width || FALLBACK_WIDTH) - PAGE_GUTTER;
      const viewport = pdfPage.getViewport({ scale: (available / unit.width) * zoom });

      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.floor(viewport.width * dpr);
      canvas.height = Math.floor(viewport.height * dpr);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      task = pdfPage.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: [dpr, 0, 0, dpr, 0, 0],
      });
      await task.promise;
    }

    render().catch(() => {
      if (!cancelled) setResult((prev) => (prev ? { ...prev, failed: true } : prev));
    });

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, currentPage, zoom, width]);

  // Keep the fullscreen state in step with the browser (Esc exits fullscreen outside our button).
  useEffect(() => {
    function onChange() {
      setFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const node = containerRef.current;
    if (!node) return;
    // The browser rejects fullscreen requests it does not allow; the button then simply does nothing.
    if (document.fullscreenElement === node) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void node.requestFullscreen().catch(() => undefined);
    }
  }, []);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  const percent = zoomPercent(zoom);

  return (
    <div
      ref={containerRef}
      data-slot="pdf-viewer"
      className={cn(
        "bg-card text-card-foreground flex min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-2xl border",
        fullscreen && "rounded-none border-0",
        className,
      )}
    >
      <div
        role="toolbar"
        aria-label={t("toolbar")}
        className="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2"
      >
        <div className="flex items-center gap-2">
          <ButtonGroup>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("previousPage")}
              disabled={status !== "ready" || !canGoPrevious(currentPage)}
              onClick={() => setPage((value) => clampPage(value - 1, pageCount))}
            >
              <ChevronLeft aria-hidden />
            </Button>
            <span
              aria-live="polite"
              className="flex h-8 min-w-16 items-center justify-center border px-2 text-sm tabular-nums"
            >
              <span className="sr-only">{t("pageLabel", { page: currentPage, total: pageCount })}</span>
              <span aria-hidden>{t("pageIndicator", { page: currentPage, total: pageCount })}</span>
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("nextPage")}
              disabled={status !== "ready" || !canGoNext(currentPage, pageCount)}
              onClick={() => setPage((value) => clampPage(value + 1, pageCount))}
            >
              <ChevronRight aria-hidden />
            </Button>
          </ButtonGroup>

          <ButtonGroup>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("zoomOut")}
              disabled={status !== "ready" || !canZoomOut(zoom)}
              onClick={() => setZoom((value) => zoomOut(value))}
            >
              <ZoomOut aria-hidden />
            </Button>
            {/* Named by its visible value first, then its purpose (WCAG 2.5.3 label in name). */}
            <Button
              variant="outline"
              size="sm"
              disabled={status !== "ready"}
              onClick={() => setZoom(DEFAULT_ZOOM)}
              className="min-w-16 tabular-nums"
            >
              {t("zoomValue", { percent })}
              <span className="sr-only">, {t("zoomReset")}</span>
            </Button>
            <Button
              variant="outline"
              size="icon-sm"
              aria-label={t("zoomIn")}
              disabled={status !== "ready" || !canZoomIn(zoom)}
              onClick={() => setZoom((value) => zoomIn(value))}
            >
              <ZoomIn aria-hidden />
            </Button>
          </ButtonGroup>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" aria-label={t("download")} onClick={onDownload}>
            <Download aria-hidden />
          </Button>
          {/* A toggle keeps one name; its state is aria-pressed alone (a changing label would contradict it). */}
          <Button
            variant="outline"
            size="icon-sm"
            aria-label={t("fullscreen")}
            aria-pressed={fullscreen}
            onClick={toggleFullscreen}
          >
            {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
          </Button>
        </div>
      </div>

      <div className="bg-muted/40 relative flex min-h-0 flex-1 justify-center overflow-auto p-4">
        {status === "loading" && (
          <div
            role="status"
            aria-label={t("loading")}
            className="flex w-full flex-col items-center gap-3 py-8"
          >
            <Skeleton className="h-[480px] w-full max-w-[420px] rounded-md" />
          </div>
        )}

        {status === "error" && (
          <div
            role="alert"
            className="text-muted-foreground flex flex-col items-center justify-center gap-3 py-12 text-center"
          >
            <TriangleAlert className="size-8" aria-hidden />
            <p className="text-sm">{t("error")}</p>
            <Button variant="outline" size="sm" onClick={retry}>
              <RotateCcw aria-hidden />
              {tCommon("actions.retry")}
            </Button>
          </div>
        )}

        <canvas
          ref={canvasRef}
          role="img"
          aria-label={t("label")}
          className={cn("bg-white shadow-sm", status !== "ready" && "hidden")}
        />
      </div>
    </div>
  );
}
