// Test-only: wire-shaped (generated DTO) documents for the HTTP-mocked tests of this feature. No real data.
// MOCK — fixtures for tests; never imported by production code.

const category = { id: "cat_legal", name: "Legal", nameEn: "Legal", color: null };
const type = {
  id: "dtype_contract",
  name: "Contrato",
  nameEn: "Contract",
  requiresSignature: true,
  hasExpiration: true,
  defaultFormat: "ARCHIVO",
} as const;
const author = { id: "usr_1", name: "Ana", imageUrl: null };

export const wireFile = (id = "fil_1") => ({
  id,
  originalName: "contrato.pdf",
  mimeType: "application/pdf",
  sizeBytes: 1024,
  status: "READY" as const,
  uploadedById: "usr_1",
  createdAt: "2026-01-01T00:00:00.000Z",
});

export const wireVersion = (overrides: Record<string, unknown> = {}) => ({
  id: "ver_2",
  documentId: "doc_1",
  versionNumber: 2,
  format: "ARCHIVO" as const,
  file: wireFile(),
  url: null,
  changelog: null,
  content: null,
  createdBy: author,
  createdAt: "2026-01-02T00:00:00.000Z",
  isCurrent: true,
  ...overrides,
});

export const wireRow = (overrides: Record<string, unknown> = {}) => ({
  id: "doc_1",
  code: "DOC-0001",
  title: "Contrato Kairos",
  category,
  type,
  status: "BORRADOR" as const,
  currentFormat: "ARCHIVO" as const,
  currentVersionNumber: 2,
  links: [{ type: "CLIENT", id: "cli_1", label: "Kairos", code: null }],
  expiresAt: null,
  isShared: false,
  tags: [],
  updatedAt: "2026-01-02T00:00:00.000Z",
  archivedAt: null,
  ...overrides,
});

export const wireDetail = (overrides: Record<string, unknown> = {}) => ({
  id: "doc_1",
  code: "DOC-0001",
  title: "Contrato Kairos",
  type,
  category,
  summary: null,
  status: "BORRADOR" as const,
  effectiveDate: null,
  signedAt: null,
  expiresAt: null,
  alertDaysBefore: 30,
  currentVersion: wireVersion(),
  versionCount: 2,
  draftContent: null,
  draftUpdatedAt: null,
  links: [
    {
      id: "lnk_1",
      createdAt: "2026-01-01T00:00:00.000Z",
      entity: { type: "CLIENT", id: "cli_1", label: "Kairos", code: null },
    },
  ],
  tags: [],
  isShared: false,
  createdBy: author,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-02T00:00:00.000Z",
  archivedAt: null,
  ...overrides,
});

export const wirePage = (items: unknown[], total = items.length) => ({
  items,
  total,
  page: 1,
  pageSize: 25,
  pageCount: 1,
});
