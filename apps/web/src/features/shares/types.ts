import type { DocumentStatus } from "@/lib/validators/enums";

/** A document the share form can include: its status (for the `ENVIADO` proposal) and its versions (for the pin). */
export interface ShareableDocument {
  id: string;
  code: string;
  title: string;
  status: DocumentStatus;
  /** The version a new link pins by default (HU-22 CA6); `null` while the document has no published version. */
  currentVersionId: string | null;
  /** Newest first. */
  versions: { id: string; versionNumber: number }[];
}

/** Where the create dialog was opened from (PRD §8.11 "Gestión"). */
export interface ShareOrigin {
  type: "DOCUMENT" | "CLIENT" | "PROJECT";
  id: string;
  label: string;
}

/** A clear access key, shown once and then dropped (DT-45). */
export interface OneTimeAccessKey {
  documentId: string;
  documentTitle: string;
  accessKey: string;
}
