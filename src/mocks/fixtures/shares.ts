// MOCK — shares fixtures of Hito 1 (PRD §8.11; data-rules.md §2, §3a Δ2; DT-45). Four portal links over the
// document fixtures: an active one with a key-protected document, an active one without keys, a revoked one and an
// expired one, plus their access log. Dates are relative to the store build time. Owned by H1-B4 T7.
//
// Keys are stored only as scrypt hashes, even here (S9). MOCK dev clear key, for local E2E only (never a real
// secret): the "Credenciales de staging — Kairos" document of the Kairos link unlocks with `KAIRO-STAGE-2026`.
// The clear key of the revoked Tamanaco link is not recorded anywhere.
import { addDays, todayInCaracas } from "@/lib/dates";
import type { DateOnly } from "@/lib/validators/common";
import type { ShareEvent } from "@/lib/validators/enums";
import type { Locale } from "@/lib/validators/preferences";
import type { ShareCountersDTO, ShareLinkDetailDTO } from "@/lib/validators/shares";
import type { UserDetailDTO } from "@/lib/validators/users";
import { mockId } from "../ids";
import type { ClientRow } from "./clients";
import type { DocumentFixtures } from "./documents";

/**
 * Δ2 `ShareLinkDocument` key columns, kept apart from the link DTO because no read DTO may carry a key or a
 * hash (C22). One row per document of a link. `accessKeyHash` is the `scrypt$N$r$p$<salt>$<hash>` string;
 * `null` = no key required.
 */
export interface ShareDocumentKeyRow {
  shareLinkId: string;
  documentId: string;
  accessKeyHash: string | null;
  accessKeyUpdatedAt: string | null;
}

/**
 * `ShareAccessLog` row (PRD §10, Δ2). Keeps the salted IP hash the lockout is keyed on (C22); the read DTO only
 * shows a 12-character prefix of it (`visitor`) and resolves the document title. Append-only.
 */
export interface ShareAccessLogRow {
  id: string;
  shareLinkId: string;
  event: ShareEvent;
  documentId: string | null;
  /** Salted SHA-256 of the visitor IP, lowercase hex (`ipHashSchema`). Never the raw IP (C20). */
  ipHash: string;
  userAgent: string | null;
  createdAt: string;
}

/** Base of the public portal URL (`<APP_URL>/s/<token>`, DT-52); the dev server when `APP_URL` is unset. */
export function shareLinkUrl(token: string): string {
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return `${base}/s/${token}`;
}

/** Status of a link on `today` (Caracas): revoked wins, then expired after its last valid day. */
export function shareStatusOn(
  link: Pick<ShareLinkDetailDTO, "revokedAt" | "expiresAt">,
  today: DateOnly,
): ShareLinkDetailDTO["status"] {
  if (link.revokedAt) return "REVOKED";
  if (link.expiresAt && link.expiresAt < today) return "EXPIRED";
  return "ACTIVE";
}

/**
 * Counters and last access derived from access-log rows (PRD §8.11 "Trazabilidad"): one per `VIEW`, `DOWNLOAD`,
 * `UNLOCK` and `UNLOCK_FAILED`. `lastAccessedAt` is the newest successful access (`VIEW`, `DOWNLOAD`, `UNLOCK`); a
 * failed unlock is an attempt, not an access.
 */
export function shareCountersOf(logs: readonly ShareAccessLogRow[]): {
  counters: ShareCountersDTO;
  lastAccessedAt: string | null;
} {
  const counters: ShareCountersDTO = {
    viewCount: 0,
    downloadCount: 0,
    unlockCount: 0,
    failedUnlockCount: 0,
  };
  let lastAccessedAt: string | null = null;
  for (const log of logs) {
    if (log.event === "VIEW") counters.viewCount += 1;
    else if (log.event === "DOWNLOAD") counters.downloadCount += 1;
    else if (log.event === "UNLOCK") counters.unlockCount += 1;
    else counters.failedUnlockCount += 1;
    if (log.event !== "UNLOCK_FAILED" && (!lastAccessedAt || log.createdAt > lastAccessedAt)) {
      lastAccessedAt = log.createdAt;
    }
  }
  return { counters, lastAccessedAt };
}

// ───────────────────────────── Seeds ─────────────────────────────

const VALERIA = "usr_valeria_rojas";
const ANDRES = "usr_andres_molina";

/** MOCK scrypt hash of the dev key `KAIRO-STAGE-2026` (see the header). */
const KAIROS_STAGING_KEY_HASH =
  "scrypt$16384$8$1$MI_QNifxe9ArfLzXNbyG6Q$3HXP2XuKD2bA4dJoMuwmdLCHmRdmK4nQWu2bZXrlMec";
/** MOCK scrypt hash of an unrecorded key (revoked link). */
const TAMANACO_NDA_KEY_HASH =
  "scrypt$16384$8$1$NXn7fk502BREpe_ApVoQgQ$QwO7V3MtXyHJpzx-AfuHKbMn3SEfbVZMxZzXCdk-rXE";

/** Salted IP hashes of three fictitious visitors. */
const VISITORS = [
  "650ca043a428c50de94168b6c98489083ef577b1a26a79768652c20b7dc46ca3",
  "3fe55cc4b586ac363f6170fc00c58f267795fdaa51e40f1601a82f105c658135",
  "b87703ce265ab9823d4a6742f1bfdabf89bf178a4a3fc14e53f8261163bc7ba5",
] as const;
const BROWSERS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/129.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
] as const;

interface DocumentSeed {
  /** Document fixture key (`doc_<key>`). */
  doc: string;
  /** Pinned version number; omitted = always the latest. */
  pin?: number;
  keyHash?: string;
  keyDaysAgo?: number;
}

/** `[event, document key or null, visitor index, hours ago]`. */
type AccessSeed = [ShareEvent, string | null, 0 | 1 | 2, number];

interface LinkSeed {
  key: string;
  token: string;
  title: string;
  message?: string;
  client?: string;
  locale: Locale;
  allowDownload: boolean;
  /** Last valid day, in days from today (negative = already expired). */
  expiresIn?: number;
  revokedDaysAgo?: number;
  createdDaysAgo: number;
  by: string;
  documents: DocumentSeed[];
  access: AccessSeed[];
}

const SEEDS: LinkSeed[] = [
  {
    key: "kairos_entrega",
    token: "qB_oM6fupiHqU3EEP1WJdPrUEEVQLSStshw-uBByF7s",
    title: "Entrega de documentación — Kairos Studio",
    message:
      "Hola equipo Kairos: aquí tienen el contrato firmado, el PRD aprobado y el acceso a staging.",
    client: "cli_kairos",
    locale: "es",
    allowDownload: true,
    expiresIn: 30,
    createdDaysAgo: 20,
    by: VALERIA,
    documents: [
      { doc: "contrato_kairos", pin: 2 },
      { doc: "prd_kairos_web" },
      { doc: "credenciales_kairos", keyHash: KAIROS_STAGING_KEY_HASH, keyDaysAgo: 20 },
    ],
    access: [
      ["VIEW", null, 0, 470],
      ["VIEW", "contrato_kairos", 0, 469],
      ["DOWNLOAD", "contrato_kairos", 0, 468],
      ["VIEW", "prd_kairos_web", 1, 300],
      ["VIEW", null, 1, 301],
      ["UNLOCK_FAILED", "credenciales_kairos", 1, 299],
      ["UNLOCK", "credenciales_kairos", 1, 298],
      ["VIEW", "credenciales_kairos", 1, 298],
      ["VIEW", null, 2, 30],
      ["VIEW", "prd_kairos_web", 2, 29],
      ["DOWNLOAD", "prd_kairos_web", 2, 28],
    ],
  },
  {
    key: "aurora_entrega",
    token: "_4pZnAM0oPtIKqdSj-Sp0aVjzcL9JUDmCKozhEX3sGo",
    title: "Acta de entrega y manual — Cafetería Aurora",
    client: "cli_cafeteria_aurora",
    locale: "es",
    allowDownload: true,
    createdDaysAgo: 40,
    by: ANDRES,
    documents: [{ doc: "acta_entrega_aurora" }, { doc: "manual_aurora", pin: 1 }],
    access: [
      ["VIEW", null, 2, 900],
      ["VIEW", "acta_entrega_aurora", 2, 899],
      ["DOWNLOAD", "manual_aurora", 2, 898],
    ],
  },
  {
    key: "tamanaco_nda",
    token: "jKfayR-yjhR8KWmwa3SY2EYchtiKTV93lqeLnwAfEeQ",
    title: "NDA — Inversiones Tamanaco",
    message: "Please review the signed NDA.",
    client: "cli_inversiones_tamanaco",
    locale: "en",
    allowDownload: false,
    revokedDaysAgo: 5,
    createdDaysAgo: 60,
    by: VALERIA,
    documents: [{ doc: "nda_tamanaco", keyHash: TAMANACO_NDA_KEY_HASH, keyDaysAgo: 60 }],
    access: [
      ["VIEW", null, 0, 1400],
      ["UNLOCK_FAILED", "nda_tamanaco", 0, 1399],
      ["UNLOCK_FAILED", "nda_tamanaco", 0, 1398],
      ["UNLOCK", "nda_tamanaco", 0, 1397],
      ["VIEW", "nda_tamanaco", 0, 1397],
    ],
  },
  {
    key: "orinoco_propuesta",
    token: "VE3SkdLgPirl7OirECK-fnjVddKW_sjAIjqx5uanl2I",
    title: "Propuesta — Seguimiento de flotas Orinoco",
    client: "cli_logistica_orinoco",
    locale: "es",
    allowDownload: true,
    expiresIn: -10,
    createdDaysAgo: 50,
    by: ANDRES,
    documents: [{ doc: "propuesta_orinoco" }],
    access: [
      ["VIEW", null, 1, 1000],
      ["VIEW", "propuesta_orinoco", 1, 999],
    ],
  },
];

// ───────────────────────────── Factory ─────────────────────────────

const daysAgo = (now: Date, days: number): string =>
  new Date(now.getTime() - days * 86_400_000).toISOString();
const hoursAgo = (now: Date, hours: number): string =>
  new Date(now.getTime() - hours * 3_600_000).toISOString();

export interface ShareFixtures {
  shareLinks: ShareLinkDetailDTO[];
  shareDocumentKeys: ShareDocumentKeyRow[];
  shareAccessLogs: ShareAccessLogRow[];
}

export interface ShareFixtureSources {
  documents: DocumentFixtures;
  clients: readonly ClientRow[];
  users: readonly UserDetailDTO[];
}

/**
 * Links, key rows and access log, relative to `now`. The link rows are complete `ShareLinkDetailDTO`s; the shares
 * service re-derives their document references, versions, counters and status on every read and mutation.
 */
export function createShareFixtures(now: Date, sources: ShareFixtureSources): ShareFixtures {
  const today = todayInCaracas(now);
  const shareLinks: ShareLinkDetailDTO[] = [];
  const shareDocumentKeys: ShareDocumentKeyRow[] = [];
  const shareAccessLogs: ShareAccessLogRow[] = [];

  for (const seed of SEEDS) {
    const shareLinkId = mockId("shr", seed.key);
    const logs = seed.access.map(([event, doc, visitor, hours], index): ShareAccessLogRow => ({
      id: mockId("sacc", `${seed.key}_${index + 1}`),
      shareLinkId,
      event,
      documentId: doc ? mockId("doc", doc) : null,
      ipHash: VISITORS[visitor],
      userAgent: BROWSERS[visitor],
      createdAt: hoursAgo(now, hours),
    }));
    shareAccessLogs.push(...logs);

    const documents = seed.documents.map((item, order) => {
      const documentId = mockId("doc", item.doc);
      const row = sources.documents.documents.find((doc) => doc.id === documentId);
      if (!row) throw new Error(`Unknown shared document ${documentId}`);
      const versions = sources.documents.documentVersions.filter(
        (version) => version.documentId === documentId,
      );
      const served = item.pin
        ? versions.find((version) => version.versionNumber === item.pin)
        : versions.find((version) => version.id === row.currentVersionId);
      if (!served) throw new Error(`Unknown version of ${documentId}`);
      const keyUpdatedAt = item.keyHash ? daysAgo(now, item.keyDaysAgo ?? 0) : null;
      shareDocumentKeys.push({
        shareLinkId,
        documentId,
        accessKeyHash: item.keyHash ?? null,
        accessKeyUpdatedAt: keyUpdatedAt,
      });
      return {
        document: { id: row.id, code: row.code, label: row.title, type: "DOCUMENT" as const },
        documentStatus: row.status,
        versionId: item.pin ? served.id : null,
        isLatest: served.id === row.currentVersionId,
        versionNumber: served.versionNumber,
        format: served.format,
        order,
        requiresAccessKey: item.keyHash !== undefined,
        accessKeyUpdatedAt: keyUpdatedAt,
        counters: shareCountersOf(logs.filter((log) => log.documentId === documentId)).counters,
      };
    });

    const client = seed.client ? sources.clients.find((row) => row.id === seed.client) : undefined;
    const author = sources.users.find((user) => user.id === seed.by);
    if (!author) throw new Error(`Unknown share author ${seed.by}`);
    const expiresAt = seed.expiresIn === undefined ? null : addDays(today, seed.expiresIn);
    const revokedAt = seed.revokedDaysAgo === undefined ? null : daysAgo(now, seed.revokedDaysAgo);
    shareLinks.push({
      id: shareLinkId,
      token: seed.token,
      url: shareLinkUrl(seed.token),
      title: seed.title,
      message: seed.message ?? null,
      client: client
        ? { id: client.id, code: client.code, label: client.tradeName, type: "CLIENT" }
        : null,
      locale: seed.locale,
      allowDownload: seed.allowDownload,
      expiresAt,
      revokedAt,
      status: shareStatusOn({ revokedAt, expiresAt }, today),
      ...shareCountersOf(logs),
      documents,
      createdBy: { id: author.id, name: author.name, imageUrl: author.imageUrl },
      createdAt: daysAgo(now, seed.createdDaysAgo),
    });
  }

  return { shareLinks, shareDocumentKeys, shareAccessLogs };
}
