/**
 * Path of the FE route handler that proxies the authenticated file download (Q-FEINT-4): the browser
 * cannot send the Bearer token to `GET /api/v1/files/{id}/download`, so links point at this FE route,
 * which calls the API server-side and answers with the signed redirect.
 */
export function fileDownloadPath(fileId: string): string {
  return `/files/${encodeURIComponent(fileId)}/download`;
}
