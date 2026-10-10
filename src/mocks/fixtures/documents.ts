// MOCK — documents and files fixtures of Hito 1 (data-rules.md §2, PRD §8.9). Minimal in H1-B2, where the
// dataset needs them for the cross-entity "Documentos" tab and the alerts; H1-B4 (documents UI) takes
// ownership of this file and extends it, keeping the exported names.
//
// m8 decision: `fileFixtures` belongs to this dataset (note attachments and the files behind `ARCHIVO`
// versions). Runtime uploads are appended to `store.files` by `services/files.ts` (unchanged). Nothing is
// really stored: the files only have metadata (C5, fictional names).
//
// Store rows are the contract minus what services derive (type and category refs, the current version,
// `versionCount`, links, tags, `isShared`, `createdBy`) plus foreign keys (PD-3). Dates that drive the
// alerts are relative to the store build clock:
//   - `doc_nda_tamanaco`      signed, expires in 21 days (inside its 30-day alert window).
//   - `doc_propuesta_orinoco` `VENCIDO`: expired 12 days ago.
//   - `doc_contrato_kairos`   linked to a client and two projects (HU-20 shape).
// Formats: `MARKDOWN` (PRD, TSD, minuta, roadmap), `ARCHIVO` (contracts, proposals…), `ENLACE` (credentials).
import { addDays, todayInCaracas, type DateOnly } from "@/lib/dates";
import type {
  DocumentDetailDTO,
  DocumentLinkEntityType,
  DocumentVersionDetailDTO,
} from "@/lib/validators/documents";
import type { DocumentFormat } from "@/lib/validators/enums";
import type { FileDTO } from "@/lib/validators/files";
import { mockId } from "../ids";

/** Document row: the contract minus what services assemble, plus foreign keys (PD-3). */
export type DocumentRow = Omit<
  DocumentDetailDTO,
  | "type"
  | "category"
  | "currentVersion"
  | "versionCount"
  | "links"
  | "tags"
  | "isShared"
  | "createdBy"
> & {
  typeId: string;
  currentVersionId: string | null;
  tagIds: string[];
  createdById: string | null;
  deletedById: string | null;
};

/** Version row: the contract minus the resolved file, author and `isCurrent` (the document points at it). */
export type DocumentVersionRow = Omit<
  DocumentVersionDetailDTO,
  "file" | "createdBy" | "isCurrent"
> & {
  fileId: string | null;
  createdById: string;
};

/** Link row (`DocumentLink`): the target travels as type + id and is resolved to an `EntityRef`. */
export interface DocumentLinkRow {
  id: string;
  documentId: string;
  entityType: DocumentLinkEntityType;
  entityId: string;
  createdAt: string;
}

// ───────────────────────────── Files ─────────────────────────────

const PDF = "application/pdf";
const PNG = "image/png";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MD = "text/markdown";

const file = (
  key: string,
  originalName: string,
  mimeType: string,
  sizeBytes: number,
  uploadedById: string,
  createdAt: string,
): FileDTO => ({
  id: mockId("fil", key),
  originalName,
  mimeType,
  sizeBytes,
  status: "READY",
  uploadedById,
  createdAt,
});

const ANDRES = "usr_andres_molina";
const VALERIA = "usr_valeria_rojas";
const CAMILA = "usr_camila_torres";
const DIEGO = "usr_diego_paredes";

/** Files behind documents and notes. Runtime uploads are appended by the files service. */
export const fileFixtures: FileDTO[] = [
  file(
    "contrato_kairos_v1",
    "contrato-kairos-borrador.pdf",
    PDF,
    184_320,
    ANDRES,
    "2026-07-02T15:10:00.000Z",
  ),
  file(
    "contrato_kairos_v2",
    "contrato-kairos-firmado.pdf",
    PDF,
    201_728,
    ANDRES,
    "2026-07-14T16:00:00.000Z",
  ),
  file("nda_tamanaco", "nda-tamanaco.pdf", PDF, 96_256, VALERIA, "2026-08-03T14:30:00.000Z"),
  file(
    "propuesta_orinoco",
    "propuesta-orinoco.pdf",
    PDF,
    512_000,
    ANDRES,
    "2026-08-19T13:20:00.000Z",
  ),
  file(
    "cotizacion_tornillo",
    "cotizacion-tornillo.pdf",
    PDF,
    143_360,
    CAMILA,
    "2026-09-05T17:45:00.000Z",
  ),
  file(
    "acta_entrega_aurora",
    "acta-entrega-aurora.pdf",
    PDF,
    88_064,
    VALERIA,
    "2026-06-12T15:00:00.000Z",
  ),
  file(
    "estado_cuenta_sep",
    "estado-de-cuenta-septiembre.pdf",
    PDF,
    66_560,
    VALERIA,
    "2026-10-01T12:00:00.000Z",
  ),
  file("wireframes_home", "wireframes-home.png", PNG, 734_003, CAMILA, "2026-08-24T18:05:00.000Z"),
  file(
    "captura_error",
    "captura-error-checkout.png",
    PNG,
    245_760,
    DIEGO,
    "2026-09-18T19:30:00.000Z",
  ),
  file("logo_kairos", "logo-kairos.png", PNG, 51_200, ANDRES, "2026-07-20T14:00:00.000Z"),
  file(
    "presupuesto_tlaloc",
    "presupuesto-tlaloc.xlsx",
    XLSX,
    38_912,
    CAMILA,
    "2026-09-22T16:15:00.000Z",
  ),
  file("notas_reunion", "notas-reunion-solaris.md", MD, 4_096, DIEGO, "2026-09-25T20:00:00.000Z"),
  file("brief_marca", "brief-de-marca.pdf", PDF, 322_560, ANDRES, "2026-08-08T15:40:00.000Z"),
];

// ───────────────────────────── Documents ─────────────────────────────

interface VersionSeed {
  format: DocumentFormat;
  daysAgo: number;
  changelog?: string;
  file?: string;
  url?: string;
  content?: string;
  by: string;
}

interface DocumentSeed {
  key: string;
  title: string;
  type: string;
  status: DocumentRow["status"];
  summary?: string;
  effective?: number;
  signed?: number;
  expires?: number;
  alertDays?: number;
  versions: readonly VersionSeed[];
  draft?: string;
  links: readonly (readonly [DocumentLinkEntityType, string])[];
  tags?: readonly string[];
  createdDaysAgo: number;
  by: string;
}

const prd = (title: string, extra: string): string =>
  `# ${title}\n\n## Objetivo\n\nDefinir el alcance y los criterios de aceptación.\n\n## Requisitos\n\n- Autenticación de usuarios\n- Panel de administración\n- ${extra}\n`;

const SEEDS: readonly DocumentSeed[] = [
  {
    key: "contrato_kairos",
    title: "Contrato de servicios — Kairos Studio",
    type: "contrato_servicios",
    status: "FIRMADO",
    summary: "Contrato marco para el desarrollo y mantenimiento del sitio y la app de Kairos.",
    effective: -90,
    signed: -85,
    expires: 400,
    alertDays: 30,
    versions: [
      {
        format: "ARCHIVO",
        daysAgo: 100,
        changelog: "Borrador enviado al cliente",
        file: "contrato_kairos_v1",
        by: ANDRES,
      },
      {
        format: "ARCHIVO",
        daysAgo: 87,
        changelog: "Versión firmada",
        file: "contrato_kairos_v2",
        by: ANDRES,
      },
    ],
    links: [
      ["CLIENT", "cli_kairos"],
      ["PROJECT", "pry_kairos_web"],
      ["PROJECT", "pry_kairos_app"],
    ],
    tags: ["cliente_clave"],
    createdDaysAgo: 100,
    by: ANDRES,
  },
  {
    key: "nda_tamanaco",
    title: "NDA — Inversiones Tamanaco",
    type: "nda",
    status: "FIRMADO",
    summary: "Acuerdo de confidencialidad vigente durante el desarrollo del ERP.",
    effective: -344,
    signed: -344,
    expires: 21,
    alertDays: 30,
    versions: [
      {
        format: "ARCHIVO",
        daysAgo: 340,
        changelog: "Versión firmada",
        file: "nda_tamanaco",
        by: VALERIA,
      },
    ],
    links: [
      ["CLIENT", "cli_inversiones_tamanaco"],
      ["PROJECT", "pry_tamanaco_erp"],
    ],
    tags: ["cliente_clave"],
    createdDaysAgo: 345,
    by: VALERIA,
  },
  {
    key: "propuesta_orinoco",
    title: "Propuesta — Seguimiento de flotas Orinoco",
    type: "propuesta",
    status: "VENCIDO",
    summary: "Propuesta comercial sin respuesta; la vigencia terminó.",
    effective: -42,
    expires: -12,
    alertDays: 15,
    versions: [
      {
        format: "ARCHIVO",
        daysAgo: 52,
        changelog: "Primera versión",
        file: "propuesta_orinoco",
        by: ANDRES,
      },
    ],
    links: [
      ["CLIENT", "cli_logistica_orinoco"],
      ["PROJECT", "pry_orinoco_tracking"],
    ],
    createdDaysAgo: 52,
    by: ANDRES,
  },
  {
    key: "prd_kairos_web",
    title: "PRD — Sitio web Kairos",
    type: "prd",
    status: "APROBADO",
    summary: "Requisitos del sitio corporativo.",
    versions: [
      {
        format: "MARKDOWN",
        daysAgo: 80,
        changelog: "Primer borrador",
        content: prd("PRD Sitio web Kairos", "Blog"),
        by: CAMILA,
      },
      {
        format: "MARKDOWN",
        daysAgo: 70,
        changelog: "Se añade formulario de contacto",
        content: prd("PRD Sitio web Kairos", "Formulario de contacto"),
        by: CAMILA,
      },
      {
        format: "MARKDOWN",
        daysAgo: 60,
        changelog: "Aprobado por el cliente",
        content: prd("PRD Sitio web Kairos", "Formulario de contacto y SEO"),
        by: ANDRES,
      },
    ],
    links: [["PROJECT", "pry_kairos_web"]],
    createdDaysAgo: 80,
    by: CAMILA,
  },
  {
    key: "tsd_andina",
    title: "TSD — Plataforma SaaS Andina",
    type: "tsd",
    status: "EN_REVISION",
    summary: "Diseño técnico de la plataforma de suscripciones.",
    versions: [
      {
        format: "MARKDOWN",
        daysAgo: 25,
        changelog: "Arquitectura inicial",
        content: prd("TSD Plataforma SaaS Andina", "Cobros con Stripe"),
        by: VALERIA,
      },
    ],
    draft: prd("TSD Plataforma SaaS Andina", "Cobros con Stripe y reintentos"),
    links: [
      ["PROJECT", "pry_andina_saas"],
      ["CLIENT", "cli_andina_software"],
    ],
    tags: ["internacional"],
    createdDaysAgo: 25,
    by: VALERIA,
  },
  {
    key: "minuta_solaris",
    title: "Minuta de arranque — Portal Solaris",
    type: "minuta",
    status: "BORRADOR",
    summary: "Acuerdos de la reunión de arranque.",
    versions: [],
    draft: "# Minuta de arranque\n\n- Alcance confirmado\n- Próxima reunión en dos semanas\n",
    links: [["PROJECT", "pry_solaris_portal"]],
    createdDaysAgo: 9,
    by: DIEGO,
  },
  {
    key: "credenciales_kairos",
    title: "Credenciales de staging — Kairos",
    type: "credenciales",
    status: "APROBADO",
    summary: "Enlace al gestor de contraseñas; no se guardan claves aquí.",
    versions: [
      {
        format: "ENLACE",
        daysAgo: 70,
        changelog: "Enlace al ítem compartido",
        url: "https://vault.example.com/shared/kairos-staging",
        by: ANDRES,
      },
    ],
    links: [["PROJECT", "pry_kairos_web"]],
    createdDaysAgo: 70,
    by: ANDRES,
  },
  {
    key: "cotizacion_tornillo",
    title: "Cotización — Tienda El Tornillo",
    type: "cotizacion",
    status: "ENVIADO",
    summary: "Cotización de la tienda en línea.",
    effective: -35,
    expires: 75,
    alertDays: 15,
    versions: [
      {
        format: "ARCHIVO",
        daysAgo: 35,
        changelog: "Cotización enviada",
        file: "cotizacion_tornillo",
        by: CAMILA,
      },
    ],
    links: [
      ["CLIENT", "cli_ferreteria_el_tornillo"],
      ["PROJECT", "pry_tornillo_tienda"],
    ],
    createdDaysAgo: 36,
    by: CAMILA,
  },
  {
    key: "roadmap_harbor",
    title: "Roadmap — Asistente de IA Harbor Point",
    type: "roadmap",
    status: "APROBADO",
    summary: "Hitos trimestrales del asistente.",
    versions: [
      {
        format: "MARKDOWN",
        daysAgo: 30,
        changelog: "Versión aprobada",
        content: prd("Roadmap Harbor Point", "Evaluación continua"),
        by: VALERIA,
      },
    ],
    links: [["PROJECT", "pry_harbor_asistente"]],
    tags: ["piloto"],
    createdDaysAgo: 31,
    by: VALERIA,
  },
  {
    key: "acta_entrega_aurora",
    title: "Acta de entrega — POS Cafetería Aurora",
    type: "acta_entrega",
    status: "FIRMADO",
    summary: "Conformidad de la entrega del punto de venta.",
    effective: -45,
    signed: -45,
    versions: [
      {
        format: "ARCHIVO",
        daysAgo: 45,
        changelog: "Acta firmada",
        file: "acta_entrega_aurora",
        by: VALERIA,
      },
    ],
    links: [
      ["CLIENT", "cli_cafeteria_aurora"],
      ["PROJECT", "pry_aurora_pos"],
    ],
    createdDaysAgo: 46,
    by: VALERIA,
  },
  {
    key: "estado_cuenta_sep",
    title: "Estado de cuenta — septiembre",
    type: "estado_cuenta",
    status: "APROBADO",
    summary: "Estado de cuenta bancario del mes, sin vínculos.",
    versions: [
      {
        format: "ARCHIVO",
        daysAgo: 8,
        changelog: "Estado de cuenta",
        file: "estado_cuenta_sep",
        by: VALERIA,
      },
    ],
    links: [],
    createdDaysAgo: 8,
    by: VALERIA,
  },
];

const day = (today: DateOnly, offset: number | undefined): DateOnly | null =>
  offset === undefined ? null : addDays(today, offset);

/** ISO timestamp `daysAgo` days before `now` (same time of day), never in the future. */
const ago = (now: Date, daysAgo: number): string =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

export interface DocumentFixtures {
  documents: DocumentRow[];
  documentVersions: DocumentVersionRow[];
  documentLinks: DocumentLinkRow[];
}

/** Fresh documents, versions and links; dates are relative to `now` (store build time). */
export function createDocumentFixtures(now: Date): DocumentFixtures {
  const today = todayInCaracas(now);
  const documents: DocumentRow[] = [];
  const documentVersions: DocumentVersionRow[] = [];
  const documentLinks: DocumentLinkRow[] = [];

  SEEDS.forEach((seed, index) => {
    const documentId = mockId("doc", seed.key);
    const versions = seed.versions.map((version, position): DocumentVersionRow => ({
      id: mockId("dver", `${seed.key}_${position + 1}`),
      documentId,
      versionNumber: position + 1,
      format: version.format,
      fileId: version.file ? mockId("fil", version.file) : null,
      url: version.url ?? null,
      changelog: version.changelog ?? null,
      createdById: version.by,
      createdAt: ago(now, version.daysAgo),
      content: version.content ?? null,
    }));
    documentVersions.push(...versions);
    seed.links.forEach(([entityType, entityId], position) => {
      documentLinks.push({
        id: mockId("dlk", `${seed.key}_${position + 1}`),
        documentId,
        entityType,
        entityId,
        createdAt: ago(now, seed.createdDaysAgo),
      });
    });
    documents.push({
      id: documentId,
      code: `DOC-${String(index + 1).padStart(4, "0")}`,
      title: seed.title,
      typeId: mockId("dtyp", seed.type),
      summary: seed.summary ?? null,
      status: seed.status,
      effectiveDate: day(today, seed.effective),
      signedAt: day(today, seed.signed),
      expiresAt: day(today, seed.expires),
      alertDaysBefore: seed.alertDays ?? 30,
      currentVersionId: versions.at(-1)?.id ?? null,
      draftContent: seed.draft ?? null,
      draftUpdatedAt: seed.draft
        ? ago(now, Math.max(1, Math.floor(seed.createdDaysAgo / 3)))
        : null,
      tagIds: (seed.tags ?? []).map((tag) => mockId("tag", tag)),
      createdById: seed.by,
      createdAt: ago(now, seed.createdDaysAgo),
      updatedAt: ago(
        now,
        versions.length > 0
          ? Math.min(seed.createdDaysAgo, seed.versions.at(-1)!.daysAgo)
          : Math.max(1, Math.floor(seed.createdDaysAgo / 3)),
      ),
      archivedAt: null,
      deletedById: null,
    });
  });

  return { documents, documentVersions, documentLinks };
}
