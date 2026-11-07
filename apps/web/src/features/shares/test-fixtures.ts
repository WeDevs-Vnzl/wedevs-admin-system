// Wire-shaped share DTOs (what the BE sends) for the HTTP-mocked tests of this module. Test only.

export const WIRE_TOKEN = "AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

const counters = { viewCount: 12, downloadCount: 4, unlockCount: 2, failedUnlockCount: 3 };
const user = { id: "usr_1", name: "Ana Pérez", imageUrl: null };

export const wireClientRef = { type: "CLIENT", id: "cli_1", label: "Kairos Studio", code: null };

export function wireShareDocument(overrides: Record<string, unknown> = {}) {
  return {
    document: { type: "DOCUMENT", id: "doc_1", label: "Master agreement", code: "DOC-1" },
    documentStatus: "APROBADO",
    versionId: "ver_2",
    isLatest: false,
    versionNumber: 2,
    format: "ARCHIVO",
    order: 0,
    requiresAccessKey: true,
    accessKeyUpdatedAt: "2026-10-02T12:00:00.000Z",
    counters,
    ...overrides,
  };
}

export function wireShareDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: "shl_1",
    token: WIRE_TOKEN,
    url: `http://localhost:3000/s/${WIRE_TOKEN}`,
    title: "Contract documents",
    message: null,
    client: wireClientRef,
    locale: "es",
    allowDownload: true,
    expiresAt: null,
    revokedAt: null,
    status: "ACTIVE",
    counters,
    lastAccessedAt: null,
    documents: [wireShareDocument()],
    createdBy: user,
    createdAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

export function wireShareRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "shl_1",
    title: "Contract documents",
    client: wireClientRef,
    documentCount: 2,
    protectedDocumentCount: 1,
    status: "ACTIVE",
    expiresAt: "2026-12-31",
    counters,
    lastAccessedAt: "2026-10-10T15:00:00.000Z",
    createdBy: user,
    createdAt: "2026-10-01T12:00:00.000Z",
    ...overrides,
  };
}

export function wireLogRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "sal_1",
    shareLinkId: "shl_1",
    event: "UNLOCK_FAILED",
    documentId: "doc_1",
    documentTitle: "Master agreement",
    visitor: "a1b2c3d4",
    userAgent: "Mozilla/5.0",
    createdAt: "2026-10-10T15:00:00.000Z",
    ...overrides,
  };
}

export const page = <T>(items: T[]) => ({
  items,
  total: items.length,
  page: 1,
  pageSize: 25,
  pageCount: 1,
});

/** `GET /documents/{id}` as the share form reads it. */
export function wireDocument(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    code: id.toUpperCase(),
    title: `Title ${id}`,
    status: "APROBADO",
    archivedAt: null,
    currentVersion: { id: `${id}_v2`, versionNumber: 2 },
    ...overrides,
  };
}

export const wireVersions = (id: string) => [
  { id: `${id}_v1`, versionNumber: 1 },
  { id: `${id}_v3`, versionNumber: 3 },
  { id: `${id}_v2`, versionNumber: 2 },
];
