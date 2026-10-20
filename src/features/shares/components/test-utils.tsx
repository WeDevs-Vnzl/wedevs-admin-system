import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enCommon from "@/i18n/messages/en/common.json";
import enEnums from "@/i18n/messages/en/enums.json";
import enPatterns from "@/i18n/messages/en/patterns.json";
import enShares from "@/i18n/messages/en/shares.json";
import enTable from "@/i18n/messages/en/table.json";
import enValidation from "@/i18n/messages/en/validation.json";
import type { ShareLinkDetailDTO, ShareLinkListRowDTO } from "@/lib/validators/shares";
import type { ShareableDocument } from "../types";

export const testMessages = {
  common: enCommon,
  enums: enEnums,
  patterns: enPatterns,
  shares: enShares,
  table: enTable,
  validation: enValidation,
};

/** Renders `ui` with the English messages the share screens read. Test only. */
export function renderWithIntl(ui: ReactNode) {
  return render(
    <NextIntlClientProvider locale="en" timeZone="America/Caracas" messages={testMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

export function installDomStubs() {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // Radix Select reads these in jsdom.
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}

export const TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

const counters = { viewCount: 12, downloadCount: 4, unlockCount: 2, failedUnlockCount: 3 };
const user = { id: "usr_1", name: "Ana Pérez", imageUrl: null };

export const listRow: ShareLinkListRowDTO = {
  id: "shl_0001",
  title: "Contract documents",
  client: { id: "cli_0001", label: "Kairos Studio", type: "CLIENT", code: "CLI-0001" },
  documentCount: 2,
  protectedDocumentCount: 1,
  status: "ACTIVE",
  expiresAt: "2026-12-31",
  counters,
  lastAccessedAt: "2026-10-10T15:00:00.000Z",
  createdBy: user,
  createdAt: "2026-10-01T12:00:00.000Z",
} as ShareLinkListRowDTO;

export const shareDetail: ShareLinkDetailDTO = {
  id: "shl_0001",
  token: TOKEN,
  url: `http://localhost:3000/s/${TOKEN}`,
  title: "Contract documents",
  message: "Please review",
  client: listRow.client,
  locale: "en",
  allowDownload: true,
  expiresAt: "2026-12-31",
  revokedAt: null,
  status: "ACTIVE",
  counters,
  lastAccessedAt: "2026-10-10T15:00:00.000Z",
  documents: [
    {
      document: { id: "doc_0001", label: "Master agreement", type: "DOCUMENT", code: "DOC-0001" },
      documentStatus: "ENVIADO",
      versionId: "ver_0002",
      isLatest: true,
      versionNumber: 2,
      format: "ARCHIVO",
      order: 0,
      requiresAccessKey: true,
      accessKeyUpdatedAt: "2026-10-01T12:00:00.000Z",
      counters: { viewCount: 8, downloadCount: 3, unlockCount: 2, failedUnlockCount: 3 },
    },
    {
      document: { id: "doc_0002", label: "NDA", type: "DOCUMENT", code: "DOC-0002" },
      documentStatus: "APROBADO",
      versionId: null,
      isLatest: true,
      versionNumber: 1,
      format: "MARKDOWN",
      order: 1,
      requiresAccessKey: false,
      accessKeyUpdatedAt: null,
      counters: { viewCount: 4, downloadCount: 1, unlockCount: 0, failedUnlockCount: 0 },
    },
  ],
  createdBy: user,
  createdAt: "2026-10-01T12:00:00.000Z",
} as ShareLinkDetailDTO;

export const shareableDocs: ShareableDocument[] = [
  {
    id: "doc_0001",
    code: "DOC-0001",
    title: "Master agreement",
    status: "APROBADO",
    currentVersionId: "ver_0002",
    versions: [
      { id: "ver_0002", versionNumber: 2 },
      { id: "ver_0001", versionNumber: 1 },
    ],
  },
  {
    id: "doc_0002",
    code: "DOC-0002",
    title: "NDA",
    status: "BORRADOR",
    currentVersionId: "ver_0010",
    versions: [{ id: "ver_0010", versionNumber: 1 }],
  },
  {
    id: "doc_0003",
    code: "DOC-0003",
    title: "Scope",
    status: "APROBADO",
    currentVersionId: "ver_0020",
    versions: [{ id: "ver_0020", versionNumber: 1 }],
  },
];
