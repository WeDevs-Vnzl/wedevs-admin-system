// MOCK — notes fixtures of Hito 1 (data-rules.md §2, PRD §8.10). Fictional content (C5). Store rows are the
// `NoteDetailDTO` contract minus what services derive (`contentText`, the author ref, tag chips, link refs
// and attachment files) plus foreign keys (`authorId`, `tagIds`, `links`, `attachmentFileIds`,
// `deletedById`), PD-3. Every note has at least one link; `contentText` is the plain-text projection the
// service computes from `content`.
//
// Cases the specs rely on: pinned and unpinned notes; `note_kairos_alcance` is linked to a client and a
// project at once (HU-23 CA2); notes by the default mock user (`usr_andres_molina`) and by others,
// several by the Member `usr_diego_paredes` (Member own-delete check, PRD §4.3); notes with attachments
// (`fileFixtures`); one archived note. Link targets: clients (`cli_*`), contacts (`con_*`), projects
// (`pry_*`) and documents (`doc_*`) of the rest of the dataset.
import type {
  RichTextDoc,
  RichTextNode,
  NoteDetailDTO,
  NoteLinkTarget,
} from "@/lib/validators/notes";
import { mockId } from "../ids";

/** Note row: the contract minus what services assemble, plus foreign keys (PD-3). */
export type NoteRow = Omit<
  NoteDetailDTO,
  "contentText" | "author" | "tags" | "links" | "attachments"
> & {
  authorId: string;
  tagIds: string[];
  links: NoteLinkTarget[];
  attachmentFileIds: string[];
  deletedById: string | null;
};

const ANDRES = "usr_andres_molina";
const VALERIA = "usr_valeria_rojas";
const CAMILA = "usr_camila_torres";
const DIEGO = "usr_diego_paredes";

type Extra = "bullets" | "tasks" | "code" | "quote" | "ordered";

interface Seed {
  key: string;
  title: string | null;
  author: string;
  links: readonly (readonly [NoteLinkTarget["entityType"], string])[];
  paragraphs: readonly string[];
  extra?: Extra;
  items?: readonly string[];
  pinned?: boolean;
  tags?: readonly string[];
  daysAgo: number;
  editedDaysAgo?: number;
  files?: readonly string[];
  archived?: boolean;
}

const SEEDS: readonly Seed[] = [
  {
    key: "kairos_alcance",
    title: "Alcance acordado con Kairos",
    author: ANDRES,
    links: [
      ["CLIENT", "cli_kairos"],
      ["PROJECT", "pry_kairos_web"],
    ],
    paragraphs: [
      "Se acordó entregar el sitio en tres fases: portafolio, blog y formulario de contacto.",
      "El cliente aprobará cada fase por correo.",
    ],
    extra: "bullets",
    items: ["Fase 1: portafolio", "Fase 2: blog", "Fase 3: contacto y SEO"],
    pinned: true,
    tags: ["prioritario"],
    daysAgo: 70,
    editedDaysAgo: 40,
  },
  {
    key: "kairos_reunion",
    title: "Reunión de seguimiento semanal",
    author: VALERIA,
    links: [["PROJECT", "pry_kairos_web"]],
    paragraphs: [
      "Revisamos el avance de la maqueta. El cliente pidió cambiar la tipografía de los títulos.",
    ],
    extra: "tasks",
    items: ["Enviar nueva paleta", "Actualizar maqueta"],
    daysAgo: 34,
  },
  {
    key: "kairos_contacto",
    title: null,
    author: ANDRES,
    links: [["CONTACT", "con_kairos_1"]],
    paragraphs: ["Prefiere que las aprobaciones lleguen por correo antes del mediodía."],
    daysAgo: 62,
  },
  {
    key: "kairos_logo",
    title: "Logo y materiales de marca",
    author: CAMILA,
    links: [["CLIENT", "cli_kairos"]],
    paragraphs: ["El cliente entregó el logo en alta resolución y el brief de marca."],
    files: ["logo_kairos", "brief_marca"],
    daysAgo: 55,
  },
  {
    key: "kairos_app_riesgo",
    title: "Riesgo: integración de pagos",
    author: VALERIA,
    links: [["PROJECT", "pry_kairos_app"]],
    paragraphs: ["La pasarela de pagos del hotel aún no entrega credenciales de pruebas."],
    extra: "quote",
    pinned: true,
    tags: ["urgente"],
    daysAgo: 12,
  },
  {
    key: "contrato_revision",
    title: "Revisión del contrato",
    author: ANDRES,
    links: [
      ["DOCUMENT", "doc_contrato_kairos"],
      ["CLIENT", "cli_kairos"],
    ],
    paragraphs: ["Legal revisó la cláusula de propiedad intelectual; sin cambios pendientes."],
    daysAgo: 88,
  },
  {
    key: "solaris_retraso",
    title: "Retraso del portal Solaris",
    author: ANDRES,
    links: [["PROJECT", "pry_solaris_portal"]],
    paragraphs: [
      "El proyecto superó la fecha objetivo. Esperamos las credenciales del sistema de facturación.",
    ],
    extra: "ordered",
    items: ["Reprogramar la entrega", "Avisar al cliente", "Actualizar el plan de cobro"],
    pinned: true,
    tags: ["urgente", "prioritario"],
    daysAgo: 9,
  },
  {
    key: "solaris_minuta",
    title: "Notas de la reunión de arranque",
    author: DIEGO,
    links: [
      ["PROJECT", "pry_solaris_portal"],
      ["DOCUMENT", "doc_minuta_solaris"],
    ],
    paragraphs: ["Se definieron los roles y el canal de comunicación."],
    files: ["notas_reunion"],
    daysAgo: 9,
  },
  {
    key: "solaris_contacto",
    title: null,
    author: VALERIA,
    links: [["CONTACT", "con_solaris_energia_1"]],
    paragraphs: ["Responde mejor por llamada que por correo."],
    daysAgo: 80,
  },
  {
    key: "solaris_cliente",
    title: "Condiciones de pago",
    author: ANDRES,
    links: [["CLIENT", "cli_solaris_energia"]],
    paragraphs: ["Pagan a 30 días y solicitan siempre la factura en PDF."],
    daysAgo: 100,
  },
  {
    key: "aurora_entrega",
    title: "Entrega del POS",
    author: VALERIA,
    links: [
      ["PROJECT", "pry_aurora_pos"],
      ["DOCUMENT", "doc_acta_entrega_aurora"],
    ],
    paragraphs: ["Se instaló en las tres sucursales. Acta firmada por la gerencia."],
    tags: ["mantenimiento"],
    daysAgo: 45,
  },
  {
    key: "aurora_contacto",
    title: null,
    author: DIEGO,
    links: [["CONTACT", "con_cafeteria_aurora_1"]],
    paragraphs: ["Quiere capacitación para el personal de caja."],
    daysAgo: 48,
  },
  {
    key: "tamanaco_nda",
    title: "NDA próximo a vencer",
    author: ANDRES,
    links: [
      ["DOCUMENT", "doc_nda_tamanaco"],
      ["CLIENT", "cli_inversiones_tamanaco"],
    ],
    paragraphs: ["El NDA vence en tres semanas; pedir renovación al cliente."],
    extra: "tasks",
    items: ["Preparar adenda", "Solicitar firma"],
    pinned: true,
    tags: ["pendiente_firma"],
    daysAgo: 6,
  },
  {
    key: "tamanaco_erp_arq",
    title: "Decisión de arquitectura",
    author: CAMILA,
    links: [["PROJECT", "pry_tamanaco_erp"]],
    paragraphs: ["Se usará un monolito modular con colas para la conciliación bancaria."],
    extra: "code",
    items: ["pnpm run reconcile --dry-run"],
    daysAgo: 52,
  },
  {
    key: "tamanaco_multi",
    title: "Tres empresas, un solo contrato",
    author: VALERIA,
    links: [
      ["PROJECT", "pry_tamanaco_erp"],
      ["CLIENT", "cli_seguros_guaicaipuro"],
      ["CLIENT", "cli_distribuidora_andes"],
    ],
    paragraphs: ["Cada empresa recibe su propia facturación; el alcance es compartido."],
    daysAgo: 85,
  },
  {
    key: "clinica_pausa",
    title: "Proyecto en pausa",
    author: ANDRES,
    links: [
      ["PROJECT", "pry_clinica_citas"],
      ["CLIENT", "cli_clinica_santa_lucia"],
    ],
    paragraphs: ["La clínica pidió pausar hasta definir el calendario de médicos."],
    daysAgo: 28,
  },
  {
    key: "clinica_contacto",
    title: null,
    author: DIEGO,
    links: [["CONTACT", "con_clinica_santa_lucia_1"]],
    paragraphs: ["Decide en conjunto con la dirección médica."],
    daysAgo: 90,
  },
  {
    key: "orinoco_propuesta",
    title: "Propuesta sin respuesta",
    author: ANDRES,
    links: [
      ["DOCUMENT", "doc_propuesta_orinoco"],
      ["PROJECT", "pry_orinoco_tracking"],
    ],
    paragraphs: ["La vigencia de la propuesta terminó. Hacer una última llamada de seguimiento."],
    tags: ["pendiente_firma"],
    daysAgo: 11,
  },
  {
    key: "tornillo_catalogo",
    title: "Carga de catálogo",
    author: CAMILA,
    links: [["PROJECT", "pry_tornillo_tienda"]],
    paragraphs: ["El cliente enviará el catálogo en una hoja de cálculo con 1.200 productos."],
    files: ["presupuesto_tlaloc"],
    daysAgo: 22,
  },
  {
    key: "tornillo_cotizacion",
    title: "Cotización enviada",
    author: CAMILA,
    links: [["DOCUMENT", "doc_cotizacion_tornillo"]],
    paragraphs: ["Cotización enviada el mes pasado; sin respuesta aún."],
    daysAgo: 34,
  },
  {
    key: "andina_stripe",
    title: "Cuenta de Stripe",
    author: VALERIA,
    links: [["PROJECT", "pry_andina_saas"]],
    paragraphs: ["La cuenta de Stripe del cliente está verificada. Falta configurar los webhooks."],
    extra: "bullets",
    items: ["invoice.paid", "customer.subscription.updated"],
    tags: ["internacional"],
    pinned: true,
    daysAgo: 18,
  },
  {
    key: "andina_tsd",
    title: "Comentarios del TSD",
    author: ANDRES,
    links: [
      ["DOCUMENT", "doc_tsd_andina"],
      ["PROJECT", "pry_andina_saas"],
    ],
    paragraphs: ["Bogotá Fintech pidió separar el módulo de cobros en un servicio propio."],
    daysAgo: 14,
  },
  {
    key: "andina_cliente",
    title: null,
    author: DIEGO,
    links: [
      ["CLIENT", "cli_andina_software"],
      ["CLIENT", "cli_bogota_fintech"],
    ],
    paragraphs: ["Ambas empresas comparten el mismo equipo de producto."],
    daysAgo: 60,
  },
  {
    key: "harbor_modelo",
    title: "Elección del modelo",
    author: CAMILA,
    links: [["PROJECT", "pry_harbor_asistente"]],
    paragraphs: ["Se comparó el desempeño de dos modelos con las preguntas de prueba del cliente."],
    extra: "quote",
    tags: ["piloto"],
    daysAgo: 20,
  },
  {
    key: "harbor_roadmap",
    title: "Roadmap aprobado",
    author: VALERIA,
    links: [["DOCUMENT", "doc_roadmap_harbor"]],
    paragraphs: ["El roadmap trimestral fue aprobado en la llamada del jueves."],
    daysAgo: 29,
  },
  {
    key: "redwood_cierre",
    title: "Cierre del dashboard",
    author: ANDRES,
    links: [
      ["PROJECT", "pry_redwood_dashboard"],
      ["CLIENT", "cli_redwood_ventures"],
    ],
    paragraphs: ["Entregado y aceptado. Pidieron una cotización para la fase dos."],
    daysAgo: 15,
  },
  {
    key: "olivar_soporte",
    title: "Soporte mensual",
    author: DIEGO,
    links: [["PROJECT", "pry_olivar_app"]],
    paragraphs: ["Incluye hasta ocho horas de soporte al mes."],
    tags: ["recurrente", "mantenimiento"],
    daysAgo: 75,
  },
  {
    key: "tlaloc_diseno",
    title: "Coordinación con el estudio de diseño",
    author: CAMILA,
    links: [
      ["PROJECT", "pry_tlaloc_ruteo"],
      ["CLIENT", "cli_cantera_estudio"],
    ],
    paragraphs: ["Cantera Estudio entrega los prototipos los lunes."],
    daysAgo: 21,
  },
  {
    key: "tlaloc_error",
    title: "Error en el checkout de pruebas",
    author: DIEGO,
    links: [["PROJECT", "pry_tlaloc_ruteo"]],
    paragraphs: ["Captura del error al confirmar la ruta. Reproducible en Firefox."],
    extra: "code",
    items: ["TypeError: Cannot read properties of undefined (reading 'stops')"],
    files: ["captura_error"],
    daysAgo: 7,
  },
  {
    key: "pampa_pipeline",
    title: "Pipeline de despliegue",
    author: VALERIA,
    links: [["PROJECT", "pry_pampa_panel"]],
    paragraphs: ["El despliegue a producción requiere aprobación manual de dos personas."],
    daysAgo: 16,
  },
  {
    key: "andespay_licencia",
    title: "Licencia regulatoria",
    author: ANDRES,
    links: [
      ["PROJECT", "pry_andespay_movil"],
      ["CLIENT", "cli_andes_pay"],
    ],
    paragraphs: [
      "Sin licencia no se puede avanzar con los pagos reales; el cliente estima dos meses.",
    ],
    daysAgo: 45,
  },
  {
    key: "canal_acta",
    title: "Acta de entrega pendiente",
    author: VALERIA,
    links: [["PROJECT", "pry_canal_portal"]],
    paragraphs: ["Falta la firma de Istmo Trading en el acta de entrega."],
    tags: ["pendiente_firma"],
    daysAgo: 58,
  },
  {
    key: "inti_visita",
    title: "Visita a la finca",
    author: CAMILA,
    links: [
      ["CLIENT", "cli_inti_agro"],
      ["PROJECT", "pry_inti_iot"],
    ],
    paragraphs: ["Se recorrieron los cultivos y se definió la ubicación de los sensores."],
    files: ["wireframes_home"],
    daysAgo: 38,
  },
  {
    key: "herrera_galerias",
    title: null,
    author: DIEGO,
    links: [["PROJECT", "pry_herrera_portafolio"]],
    paragraphs: ["Las galerías cargan rápido gracias a imágenes optimizadas."],
    daysAgo: 101,
  },
  {
    key: "whitfield_mvp",
    title: "Definición del MVP",
    author: ANDRES,
    links: [["PROJECT", "pry_whitfield_mvp"]],
    paragraphs: ["El MVP solo incluye registro, publicación de servicios y pagos."],
    extra: "ordered",
    items: ["Registro", "Publicar servicio", "Pagar"],
    tags: ["internacional", "piloto"],
    daysAgo: 11,
  },
  {
    key: "whitfield_cliente",
    title: null,
    author: VALERIA,
    links: [["CLIENT", "cli_jordan_whitfield"]],
    paragraphs: ["Prefiere comunicarse en inglés, por mensajes cortos."],
    tags: ["internacional"],
    daysAgo: 13,
  },
  {
    key: "prd_kairos_nota",
    title: "PRD aprobado",
    author: CAMILA,
    links: [["DOCUMENT", "doc_prd_kairos_web"]],
    paragraphs: ["La tercera versión del PRD es la vigente."],
    daysAgo: 60,
  },
  {
    key: "credenciales_aviso",
    title: "Credenciales en el gestor",
    author: ANDRES,
    links: [["DOCUMENT", "doc_credenciales_kairos"]],
    paragraphs: ["Nunca se guardan claves en notas ni documentos: solo el enlace al gestor."],
    pinned: true,
    daysAgo: 70,
  },
  {
    key: "estado_cuenta",
    title: "Conciliación de septiembre",
    author: VALERIA,
    links: [["DOCUMENT", "doc_estado_cuenta_sep"]],
    paragraphs: ["Revisado contra los movimientos del mes."],
    daysAgo: 7,
  },
  {
    key: "mediterraneo_idea",
    title: "Idea de CRM",
    author: DIEGO,
    links: [["PROJECT", "pry_mediterraneo_crm"]],
    paragraphs: ["Podría integrarse con el calendario del taller para citas de revisión."],
    daysAgo: 30,
  },
  {
    key: "borrada_prueba",
    title: "Nota de prueba",
    author: DIEGO,
    links: [["CLIENT", "cli_gabriela_linares"]],
    paragraphs: ["Nota creada por error."],
    daysAgo: 26,
    archived: true,
  },
];

// ───────────────────────────── Rich text ─────────────────────────────

const text = (value: string): RichTextNode => ({ type: "text", text: value });
const paragraph = (value: string): RichTextNode => ({ type: "paragraph", content: [text(value)] });
const listItem = (value: string): RichTextNode => ({
  type: "listItem",
  content: [paragraph(value)],
});

function content(seed: Seed): RichTextDoc {
  const nodes = seed.paragraphs.map(paragraph);
  const items = seed.items ?? [];
  switch (seed.extra) {
    case "bullets":
      nodes.push({ type: "bulletList", content: items.map(listItem) });
      break;
    case "ordered":
      nodes.push({ type: "orderedList", content: items.map(listItem) });
      break;
    case "tasks":
      nodes.push({
        type: "taskList",
        content: items.map((item, index) => ({
          type: "taskItem",
          attrs: { checked: index === 0 },
          content: [paragraph(item)],
        })),
      });
      break;
    case "code":
      nodes.push({ type: "codeBlock", content: items.map(text) });
      break;
    case "quote":
      nodes.push({ type: "blockquote", content: [paragraph(seed.paragraphs[0] ?? "")] });
      break;
    default:
      break;
  }
  return { type: "doc", content: nodes };
}

const ago = (now: Date, daysAgo: number): string =>
  new Date(now.getTime() - daysAgo * 86_400_000).toISOString();

/** Fresh note rows; dates are relative to `now` (store build time). */
export function createNoteFixtures(now: Date): NoteRow[] {
  return SEEDS.map((seed): NoteRow => {
    const createdAt = ago(now, seed.daysAgo);
    const archivedAt = seed.archived ? ago(now, 20) : null;
    return {
      id: mockId("note", seed.key),
      title: seed.title,
      content: content(seed),
      authorId: seed.author,
      pinned: seed.pinned ?? false,
      tagIds: (seed.tags ?? []).map((tag) => mockId("tag", tag)),
      links: seed.links.map(([entityType, entityId]) => ({ entityType, entityId })),
      attachmentFileIds: (seed.files ?? []).map((file) => mockId("fil", file)),
      createdAt,
      updatedAt: archivedAt ?? (seed.editedDaysAgo ? ago(now, seed.editedDaysAgo) : createdAt),
      archivedAt,
      deletedById: archivedAt ? seed.author : null,
    };
  });
}
