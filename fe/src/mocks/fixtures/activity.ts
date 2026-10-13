// MOCK — activity and alert-state fixtures of Hito 1 (data-rules.md §2, PRD §8.14). Fictional events (C5)
// narrated over the commercial dataset: about 150 entries spread over the last ~60 days with `USER`,
// `SYSTEM` and `PUBLIC` actors and the actions `CREATE`, `UPDATE` (with field diffs), `DELETE`, `RESTORE`,
// `STATUS_CHANGE`, `LINK`, `UNLINK`, `UPLOAD`, `VERSION_PUBLISH`, `LOGIN`, `SYSTEM_JOB` and `PORTAL_ACCESS`.
// Timestamps are relative to the store build clock. IPs come only from the documentation ranges
// 192.0.2.0/24 and 198.51.100.0/24 (RFC 5737, C5) and exist on `USER` actions only. No diff carries a
// sensitive field (the tax id is excluded); long texts are recorded as the `"changed"` marker.
//
// Store rows are the `ActivityEntryDTO` contract with the actor reduced to `actorType` + `actorId`
// (PD-3); the service resolves the name from the users. Append-only (C20): nothing updates these rows.
// `PORTAL_ACCESS` entries are visitors opening a shared document; the share links themselves arrive with
// the documents batch (H1-B4). `alertDismissalFixtures` stays empty until the alerts UI (this batch, W2).
import { diffFields } from "@/lib/activity-diff";
import type { ActivityAction, ActorType, EntityType } from "@/lib/validators/enums";
import type {
  ActivityChanges,
  ActivityEntryDTO,
  ActivityMetadata,
} from "@/lib/validators/activity";
import type { AlertDismissalDTO } from "@/lib/validators/alerts";
import { firstWords, richTextToPlainText } from "../entity-refs";
import { createClientFixtures, type ClientRow } from "./clients";
import { createDocumentFixtures, fileFixtures } from "./documents";
import { createNoteFixtures } from "./notes";
import { createProjectFixtures } from "./projects";

/** Per-user alert dismissal or snooze (`AlertDismissal` in Hito 2). */
export interface AlertDismissalRow extends AlertDismissalDTO {
  userId: string;
}

/** Activity row: the entry with the actor reduced to its type and id (PD-3). */
export type ActivityRow = Omit<ActivityEntryDTO, "actor"> & {
  actorType: ActorType;
  actorId: string | null;
};

export const alertDismissalFixtures: AlertDismissalRow[] = [];

// ───────────────────────────── Generation ─────────────────────────────

const WINDOW_DAYS = 60;
const DAY_MS = 86_400_000;

const ANDRES = "usr_andres_molina";
const VALERIA = "usr_valeria_rojas";
const CAMILA = "usr_camila_torres";
const DIEGO = "usr_diego_paredes";

const USER_NAMES: Record<string, string> = {
  [ANDRES]: "Andrés Molina",
  [VALERIA]: "Valeria Rojas",
  [CAMILA]: "Camila Torres",
  [DIEGO]: "Diego Paredes",
};

/** Each user's usual address (documentation ranges only) and browser. */
const USER_IP: Record<string, string> = {
  [ANDRES]: "192.0.2.14",
  [VALERIA]: "198.51.100.23",
  [CAMILA]: "192.0.2.130",
  [DIEGO]: "198.51.100.88",
};
const USER_AGENTS = [
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
];
const USER_AGENT_BY_USER: Record<string, string> = {
  [ANDRES]: USER_AGENTS[0]!,
  [VALERIA]: USER_AGENTS[1]!,
  [CAMILA]: USER_AGENTS[2]!,
  [DIEGO]: USER_AGENTS[0]!,
};

/** The mutating staff of the commercial core, in rotation (the Member only writes his own notes). */
const STAFF = [ANDRES, VALERIA, CAMILA] as const;

interface Draft {
  at: number;
  actorType: ActorType;
  actorId: string | null;
  action: ActivityAction;
  entityType: EntityType;
  entityId: string;
  entityLabel: string;
  changes?: ActivityChanges | undefined;
  metadata?: ActivityMetadata | undefined;
}

/** Fresh activity rows, oldest first, relative to `now` (store build time). */
export function createActivityFixtures(now: Date): ActivityRow[] {
  const end = now.getTime() - 60_000;
  const start = now.getTime() - WINDOW_DAYS * DAY_MS;
  const clamp = (time: number): number => Math.min(end, Math.max(start, time));
  const t = (iso: string, offsetHours = 0): number =>
    clamp(Date.parse(iso) + offsetHours * 3_600_000);
  const hoursAgo = (hours: number): number => clamp(now.getTime() - hours * 3_600_000);

  const clients = createClientFixtures(now);
  const projects = createProjectFixtures(now);
  const notes = createNoteFixtures(now);
  const { documents, documentLinks, documentVersions } = createDocumentFixtures(now);
  const drafts: Draft[] = [];
  // The log covers the window only: older events of the dataset predate it.
  const push = (draft: Draft): void => {
    if (draft.at >= start && draft.at <= end) drafts.push(draft);
  };
  const user = (index: number): string => STAFF[index % STAFF.length]!;

  const noteLabel = (note: (typeof notes)[number]): string =>
    note.title ?? (firstWords(richTextToPlainText(note.content)) || note.id);

  // Creation of everything created inside the window.
  clients.forEach((client, index) => {
    if (Date.parse(client.createdAt) >= start) {
      push({
        at: t(client.createdAt),
        actorType: "USER",
        actorId: user(index),
        action: "CREATE",
        entityType: "CLIENT",
        entityId: client.id,
        entityLabel: client.tradeName,
        metadata: { code: client.code },
      });
    }
  });
  projects.forEach((project, index) => {
    if (Date.parse(project.createdAt) >= start) {
      push({
        at: t(project.createdAt),
        actorType: "USER",
        actorId: user(index + 1),
        action: "CREATE",
        entityType: "PROJECT",
        entityId: project.id,
        entityLabel: project.name,
        metadata: { code: project.code },
      });
    }
  });
  notes.forEach((note) => {
    if (Date.parse(note.createdAt) >= start) {
      push({
        at: t(note.createdAt),
        actorType: "USER",
        actorId: note.authorId,
        action: "CREATE",
        entityType: "NOTE",
        entityId: note.id,
        entityLabel: noteLabel(note),
      });
    }
    if (note.updatedAt !== note.createdAt && !note.archivedAt) {
      push({
        at: t(note.updatedAt),
        actorType: "USER",
        actorId: note.authorId,
        action: "UPDATE",
        entityType: "NOTE",
        entityId: note.id,
        entityLabel: noteLabel(note),
        changes: { content: "changed" },
      });
    }
  });
  documents.forEach((doc) => {
    if (Date.parse(doc.createdAt) >= start) {
      push({
        at: t(doc.createdAt),
        actorType: "USER",
        actorId: doc.createdById,
        action: "CREATE",
        entityType: "DOCUMENT",
        entityId: doc.id,
        entityLabel: doc.title,
        metadata: { code: doc.code },
      });
    }
  });

  // Client edits: the diff goes from an earlier value to the stored one.
  const clientEdits: readonly (readonly [keyof ClientRow, (row: ClientRow) => string | null])[] = [
    ["phone", (row) => `${row.phone.slice(0, -1)}${(Number(row.phone.slice(-1)) + 1) % 10}`],
    ["address", () => "Av. Libertador 10, Torre Norte"],
    ["email", (row) => (row.email ? `info@${row.email.split("@")[1]}` : null)],
    ["website", () => null],
    ["tradeName", (row) => `${row.tradeName.split(" ")[0]} Group`],
  ];
  clients
    .filter((client) => !client.archivedAt && client.code !== "CLI-0001")
    .forEach((client, index) => {
      if (index % 6 !== 0) return;
      const [field, previous] = clientEdits[index % clientEdits.length]!;
      const before = { ...client, [field]: previous(client) };
      const changes = diffFields(before, client, {
        fields: ["tradeName", "legalName", "phone", "email", "website", "address", "taxId"],
        exclude: ["taxId"],
      });
      if (!changes) return;
      push({
        at: t(client.updatedAt),
        actorType: "USER",
        actorId: user(index),
        action: "UPDATE",
        entityType: "CLIENT",
        entityId: client.id,
        entityLabel: client.tradeName,
        changes,
      });
    });

  // Prospects that became clients.
  clients.forEach((client, index) => {
    if (client.activatedAt && Date.parse(client.activatedAt) >= start && !client.archivedAt) {
      push({
        at: t(client.activatedAt),
        actorType: "USER",
        actorId: user(index),
        action: "STATUS_CHANGE",
        entityType: "CLIENT",
        entityId: client.id,
        entityLabel: client.tradeName,
        changes: { status: ["PROSPECTO", client.status] },
      });
    }
  });

  // Project lifecycle and edits.
  const stateBefore = {
    EN_CURSO: "PROPUESTA",
    ENTREGADO: "EN_CURSO",
    MANTENIMIENTO: "ENTREGADO",
    PAUSADO: "EN_CURSO",
    CANCELADO: "EN_CURSO",
  } as const;
  projects.forEach((project, index) => {
    if (project.status !== "PROPUESTA" && !project.archivedAt && index % 4 !== 3) {
      const day = project.status === "ENTREGADO" ? project.endDate : project.startDate;
      if (day) {
        push({
          at: t(`${day}T15:00:00.000Z`),
          actorType: "USER",
          actorId: user(index),
          action: "STATUS_CHANGE",
          entityType: "PROJECT",
          entityId: project.id,
          entityLabel: project.name,
          changes: { status: [stateBefore[project.status], project.status] },
        });
      }
    }
    if (index % 5 === 0 && !project.archivedAt) {
      const changes = diffFields(
        {
          summary: "Resumen anterior",
          description: "Descripción anterior",
          targetEndDate: project.startDate,
        },
        {
          summary: project.summary,
          description: project.description ? "nueva" : "Descripción anterior",
          targetEndDate: project.targetEndDate,
        },
        { fields: ["summary", "description", "targetEndDate"], longText: ["description"] },
      );
      push({
        at: t(project.updatedAt),
        actorType: "USER",
        actorId: user(index + 2),
        action: "UPDATE",
        entityType: "PROJECT",
        entityId: project.id,
        entityLabel: project.name,
        changes,
      });
    }
    project.links.slice(0, 1).forEach((link, position) => {
      if (index % 4 === 0) {
        push({
          at: t(project.updatedAt, -(position + 1) * 5),
          actorType: "USER",
          actorId: user(index),
          action: "LINK",
          entityType: "PROJECT",
          entityId: project.id,
          entityLabel: project.name,
          metadata: { group: link.group, label: link.label },
        });
      }
    });
  });
  const kairosWeb = projects.find((project) => project.id === "pry_kairos_web");
  if (kairosWeb) {
    push({
      at: hoursAgo(30),
      actorType: "USER",
      actorId: ANDRES,
      action: "UNLINK",
      entityType: "PROJECT",
      entityId: kairosWeb.id,
      entityLabel: kairosWeb.name,
      metadata: { group: "ENTORNO", label: "Entorno antiguo" },
    });
    push({
      at: hoursAgo(31),
      actorType: "USER",
      actorId: ANDRES,
      action: "LINK",
      entityType: "PROJECT",
      entityId: kairosWeb.id,
      entityLabel: kairosWeb.name,
      metadata: { group: "ENTORNO", label: "Staging" },
    });
  }

  // Documents: links, published versions, expiry job.
  documentLinks.forEach((link, index) => {
    const doc = documents.find((item) => item.id === link.documentId);
    if (!doc || index % 3 === 2) return;
    push({
      at: t(link.createdAt, 1 + (index % 3)),
      actorType: "USER",
      actorId: doc.createdById,
      action: "LINK",
      entityType: "DOCUMENT",
      entityId: doc.id,
      entityLabel: doc.title,
      metadata: { entityType: link.entityType, entityId: link.entityId },
    });
  });
  documentVersions.forEach((version) => {
    const doc = documents.find((item) => item.id === version.documentId);
    if (!doc || Date.parse(version.createdAt) < start) return;
    push({
      at: t(version.createdAt),
      actorType: "USER",
      actorId: version.createdById,
      action: version.format === "ARCHIVO" ? "UPLOAD" : "VERSION_PUBLISH",
      entityType: "DOCUMENT",
      entityId: doc.id,
      entityLabel: doc.title,
      metadata: { version: version.versionNumber, format: version.format },
    });
  });
  const expired = documents.find((doc) => doc.status === "VENCIDO");
  const expiring = documents.find((doc) => doc.id === "doc_nda_tamanaco");
  if (expired?.expiresAt) {
    push({
      at: t(`${expired.expiresAt}T09:00:00.000Z`, 24),
      actorType: "SYSTEM",
      actorId: null,
      action: "SYSTEM_JOB",
      entityType: "DOCUMENT",
      entityId: expired.id,
      entityLabel: expired.title,
      changes: { status: ["ENVIADO", "VENCIDO"] },
      metadata: { job: "document-expiry" },
    });
  }
  for (let day = 0; day < 4; day += 1) {
    const doc =
      day % 2 === 0 ? expiring : documents.find((item) => item.id === "doc_cotizacion_tornillo");
    if (doc) {
      push({
        at: hoursAgo(5 + day * 24 * 9),
        actorType: "SYSTEM",
        actorId: null,
        action: "SYSTEM_JOB",
        entityType: "DOCUMENT",
        entityId: doc.id,
        entityLabel: doc.title,
        metadata: { job: "alert-evaluation", rule: "DOCUMENT_EXPIRING" },
      });
    }
  }

  // Uploads of the file fixtures.
  fileFixtures.forEach((file, index) => {
    if (index % 3 === 0) {
      push({
        at: t(file.createdAt),
        actorType: "USER",
        actorId: file.uploadedById,
        action: "UPLOAD",
        entityType: "FILE",
        entityId: file.id,
        entityLabel: file.originalName,
        metadata: { sizeBytes: file.sizeBytes },
      });
    }
  });

  // Archive and restore.
  for (const client of clients.filter((item) => item.archivedAt)) {
    push({
      at: t(client.archivedAt!),
      actorType: "USER",
      actorId: client.deletedById,
      action: "DELETE",
      entityType: "CLIENT",
      entityId: client.id,
      entityLabel: client.tradeName,
      metadata: { archivedContacts: 2 },
    });
  }
  for (const project of projects.filter((item) => item.archivedAt)) {
    push({
      at: t(project.archivedAt!),
      actorType: "USER",
      actorId: project.deletedById,
      action: "DELETE",
      entityType: "PROJECT",
      entityId: project.id,
      entityLabel: project.name,
    });
  }
  for (const note of notes.filter((item) => item.archivedAt)) {
    push({
      at: t(note.archivedAt!),
      actorType: "USER",
      actorId: note.deletedById,
      action: "DELETE",
      entityType: "NOTE",
      entityId: note.id,
      entityLabel: noteLabel(note),
    });
  }
  const restored = clients.find((client) => client.id === "cli_ron_cumana");
  if (restored) {
    push({
      at: hoursAgo(24 * 33),
      actorType: "USER",
      actorId: CAMILA,
      action: "DELETE",
      entityType: "CLIENT",
      entityId: restored.id,
      entityLabel: restored.tradeName,
    });
    push({
      at: hoursAgo(24 * 31),
      actorType: "USER",
      actorId: VALERIA,
      action: "RESTORE",
      entityType: "CLIENT",
      entityId: restored.id,
      entityLabel: restored.tradeName,
    });
  }
  const restoredNote = notes.find((note) => note.id === "note_mediterraneo_idea");
  if (restoredNote) {
    push({
      at: hoursAgo(24 * 14),
      actorType: "USER",
      actorId: DIEGO,
      action: "DELETE",
      entityType: "NOTE",
      entityId: restoredNote.id,
      entityLabel: noteLabel(restoredNote),
    });
    push({
      at: hoursAgo(24 * 14 - 2),
      actorType: "USER",
      actorId: DIEGO,
      action: "RESTORE",
      entityType: "NOTE",
      entityId: restoredNote.id,
      entityLabel: noteLabel(restoredNote),
    });
  }

  // Sign-ins, spread over the window.
  const people = [ANDRES, VALERIA, CAMILA, DIEGO];
  for (let index = 0; index < 10; index += 1) {
    const userId = people[index % people.length]!;
    push({
      at: hoursAgo(index * 130 + (index % 4) * 3 + 2),
      actorType: "USER",
      actorId: userId,
      action: "LOGIN",
      entityType: "USER",
      entityId: userId,
      entityLabel: USER_NAMES[userId]!,
    });
  }

  // Portal visitors opening shared documents.
  const shared = ["doc_contrato_kairos", "doc_cotizacion_tornillo", "doc_roadmap_harbor"];
  for (let index = 0; index < 5; index += 1) {
    const doc = documents.find((item) => item.id === shared[index % shared.length]);
    if (doc) {
      push({
        at: hoursAgo(40 + index * 170),
        actorType: "PUBLIC",
        actorId: null,
        action: "PORTAL_ACCESS",
        entityType: "DOCUMENT",
        entityId: doc.id,
        entityLabel: doc.title,
        metadata: { event: index % 3 === 2 ? "DOWNLOAD" : "VIEW" },
      });
    }
  }

  return drafts
    .sort((a, b) => a.at - b.at)
    .map((draft, index): ActivityRow => {
      const isUser = draft.actorType === "USER" && draft.actorId !== null;
      return {
        id: `act_${String(index + 1).padStart(4, "0")}`,
        actorType: draft.actorType,
        actorId: draft.actorId,
        action: draft.action,
        entityType: draft.entityType,
        entityId: draft.entityId,
        entityLabel: draft.entityLabel,
        changes: draft.changes ?? null,
        metadata: draft.metadata ?? null,
        ip: isUser ? (USER_IP[draft.actorId!] ?? null) : null,
        userAgent: isUser ? (USER_AGENT_BY_USER[draft.actorId!] ?? null) : null,
        createdAt: new Date(draft.at).toISOString(),
      };
    });
}
