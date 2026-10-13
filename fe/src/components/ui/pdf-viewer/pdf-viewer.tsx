"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";

import { Skeleton } from "@/components/ui/skeleton";

import type { PdfViewerCoreProps } from "./pdf-viewer-core";

// pdf.js (~1 MB) is loaded only when a viewer is rendered, and never on the server.
export const PdfViewer = dynamic<PdfViewerCoreProps>(
  () => import("./pdf-viewer-core").then((module) => module.PdfViewerCore),
  { ssr: false, loading: PdfViewerFallback },
);

function PdfViewerFallback() {
  const t = useTranslations("common.pdfViewer");
  return (
    <div
      role="status"
      aria-label={t("loading")}
      className="bg-card flex min-h-0 w-full min-w-0 flex-col rounded-2xl border p-4"
    >
      <Skeleton className="h-10 w-full" />
      <Skeleton className="mx-auto mt-4 h-[480px] w-full max-w-[420px] rounded-md" />
    </div>
  );
}
