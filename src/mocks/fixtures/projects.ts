// MOCK — projects fixtures of Hito 1 (data-rules.md §2, PRD §8.3). Fictional studio dataset (C5): invented
// projects and `.example.com` links. Store rows are the `ProjectDetailDTO` contract minus what services
// derive (clients as refs, stack and tags as chips, the financial headline and `hasBillingPlan`, which come
// from the finance collections, PD-4) plus foreign keys (`clients`, `technologyIds`, `tagIds`,
// `deletedById`), PD-3. Dates driving status and alerts are relative to the store build clock.
//
// Ids are `pry_<key>`; links `plk_<key>_<n>`. Cases the specs rely on:
//   - every `ProjectStatus`; ≥ 5 projects with two or three clients and roles.
//   - Next.js (`tec_next_js`) in several projects (HU-06 CA2: filter by technology); technologies such as
//     Rust, Go, Hono or Svelte are used by none (HU-06 CA3: deletable) — everything else in the catalog is
//     only used when listed here.
//   - links in six groups (HU-07); `pry_kairos_web` has two `REPOSITORIO` links. Descriptions use
//     allowlisted Tiptap nodes only (no images).
//   - `pry_solaris_portal` is `EN_CURSO` past its target date; `pry_tlaloc_ruteo` is due within 14 days.
//   - one archived project (of the archived client).
import { addDays, todayInCaracas, type DateOnly } from "@/lib/dates";
import type { ProjectLinkGroup, ProjectStatus } from "@/lib/validators/enums";
import type { RichTextDoc, RichTextNode } from "@/lib/validators/notes";
import type { ProjectDetailDTO } from "@/lib/validators/projects";
import { mockId } from "../ids";

/** Client of a project row: the foreign key and the free-text role. */
export interface ProjectClientRow {
  clientId: string;
  role: string | null;
}

/** Project row: the contract minus what services derive, plus foreign keys (PD-3, PD-4). */
export type ProjectRow = Omit<
  ProjectDetailDTO,
  | "clients"
  | "stack"
  | "tags"
  | "contractedValueUsd"
  | "invoicedUsd"
  | "collectedUsd"
  | "toInvoiceUsd"
  | "hasBillingPlan"
> & {
  clients: ProjectClientRow[];
  technologyIds: string[];
  tagIds: string[];
  deletedById: string | null;
};

const ARCHIVER_ID = "usr_camila_torres";

// ───────────────────────────── Rich text helpers ─────────────────────────────

const text = (value: string, bold = false): RichTextNode =>
  bold ? { type: "text", text: value, marks: [{ type: "bold" }] } : { type: "text", text: value };

const paragraph = (...content: RichTextNode[]): RichTextNode => ({ type: "paragraph", content });

const heading = (value: string): RichTextNode => ({
  type: "heading",
  attrs: { level: 2 },
  content: [text(value)],
});

const bullets = (items: readonly string[]): RichTextNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [paragraph(text(item))] })),
});

function description(goal: string, scope: readonly string[]): RichTextDoc {
  return {
    type: "doc",
    content: [
      heading("Objetivo"),
      paragraph(text(goal)),
      heading("Alcance"),
      bullets(scope),
      paragraph(text("Entrega acordada: ", true), text("según el plan de hitos del proyecto.")),
    ],
  };
}

// ───────────────────────────── Seeds ─────────────────────────────

type ClientSeed = readonly [clientKey: string, role: string | null];

interface Seed {
  key: string;
  name: string;
  status: ProjectStatus;
  clients: readonly ClientSeed[];
  tech: readonly string[];
  tags?: readonly string[];
  /** Day offsets from today: start, target end, actual end. */
  start?: number;
  target?: number;
  end?: number;
  summary: string;
  goal?: string;
  scope?: readonly string[];
  links?: readonly (readonly [ProjectLinkGroup, string])[];
  archived?: boolean;
}

const SEEDS: readonly Seed[] = [
  {
    key: "kairos_web",
    name: "Sitio web Kairos Studio",
    status: "EN_CURSO",
    clients: [["kairos", "Contratante"]],
    tech: ["next_js", "react", "typescript", "tailwind_css", "vercel", "figma"],
    tags: ["prioritario"],
    start: -75,
    target: 18,
    summary: "Sitio corporativo con portafolio, blog y formulario de contacto para Kairos Studio.",
    goal: "Renovar la presencia web de Kairos Studio con un sitio rápido y fácil de mantener.",
    scope: ["Diseño responsive", "Blog con categorías", "Formulario de contacto", "SEO básico"],
    links: [
      ["REPOSITORIO", "Frontend"],
      ["REPOSITORIO", "CMS"],
      ["ENTORNO", "Staging"],
      ["ENTORNO", "Producción"],
      ["DISENO", "Maqueta en Figma"],
      ["GESTION", "Tablero de tareas"],
      ["DOCUMENTACION", "Guía de contenidos"],
    ],
  },
  {
    key: "kairos_app",
    name: "App de reservas Kairos",
    status: "EN_CURSO",
    clients: [
      ["kairos", "Contratante"],
      ["hotel_mochima", "Usuario final"],
    ],
    tech: ["react_native", "expo", "typescript", "node_js", "postgresql", "prisma"],
    tags: ["recurrente"],
    start: -40,
    target: 55,
    summary:
      "Aplicación móvil para reservar salas y servicios, usada por Kairos y el Hotel Playa Mochima.",
    goal: "Permitir reservas desde el teléfono con confirmación inmediata.",
    scope: ["Calendario de disponibilidad", "Notificaciones push", "Pagos al reservar"],
    links: [
      ["REPOSITORIO", "App móvil"],
      ["ENTORNO", "Build de pruebas"],
      ["COMUNICACION", "Canal del proyecto"],
    ],
  },
  {
    key: "kairos_mantenimiento",
    name: "Mantenimiento web Kairos",
    status: "MANTENIMIENTO",
    clients: [["kairos", null]],
    tech: ["wordpress", "php", "mysql"],
    tags: ["mantenimiento", "recurrente"],
    start: -300,
    target: -240,
    end: -235,
    summary: "Soporte mensual del sitio anterior de Kairos mientras se completa la migración.",
    links: [["INFRAESTRUCTURA", "Panel de hosting"]],
  },
  {
    key: "solaris_portal",
    name: "Portal de clientes Solaris",
    status: "EN_CURSO",
    clients: [["solaris_energia", "Contratante"]],
    tech: ["next_js", "typescript", "postgresql", "prisma", "clerk", "docker"],
    tags: ["urgente"],
    start: -120,
    target: -10,
    summary:
      "Portal para que los clientes de Solaris consulten consumos, facturas y tickets de soporte.",
    goal: "Reducir las llamadas de soporte con un portal de autoservicio.",
    scope: ["Inicio de sesión", "Consumo mensual", "Descarga de facturas", "Tickets"],
    links: [
      ["REPOSITORIO", "Monorepo"],
      ["ENTORNO", "Staging"],
      ["DOCUMENTACION", "Wiki técnica"],
    ],
  },
  {
    key: "aurora_pos",
    name: "Punto de venta Cafetería Aurora",
    status: "ENTREGADO",
    clients: [["cafeteria_aurora", "Contratante"]],
    tech: ["react", "node_js", "express", "mongodb"],
    start: -200,
    target: -50,
    end: -45,
    summary: "Punto de venta táctil con inventario y cierre de caja para las sucursales de Aurora.",
    links: [
      ["REPOSITORIO", "Código fuente"],
      ["DOCUMENTACION", "Manual de operación"],
    ],
  },
  {
    key: "tamanaco_erp",
    name: "ERP financiero Tamanaco",
    status: "EN_CURSO",
    clients: [
      ["inversiones_tamanaco", "Contratante"],
      ["seguros_guaicaipuro", "Patrocinador"],
      ["distribuidora_andes", "Usuario final"],
    ],
    tech: ["nestjs", "typescript", "postgresql", "redis", "kubernetes", "aws"],
    tags: ["cliente_clave", "prioritario"],
    start: -90,
    target: 40,
    summary:
      "ERP financiero compartido por tres empresas del grupo, con conciliación bancaria y reportes.",
    goal: "Unificar la contabilidad de tres empresas en una sola plataforma.",
    scope: ["Plan de cuentas", "Conciliación bancaria", "Reportes consolidados"],
    links: [
      ["REPOSITORIO", "Backend"],
      ["INFRAESTRUCTURA", "Clúster de producción"],
      ["GESTION", "Roadmap"],
      ["COMUNICACION", "Canal del proyecto"],
    ],
  },
  {
    key: "clinica_citas",
    name: "Citas médicas Santa Lucía",
    status: "PAUSADO",
    clients: [["clinica_santa_lucia", "Contratante"]],
    tech: ["vue_js", "nuxt", "laravel", "mysql"],
    start: -150,
    target: 25,
    summary:
      "Agenda en línea de citas médicas, en pausa hasta que la clínica defina el calendario de médicos.",
    links: [["REPOSITORIO", "Código fuente"]],
  },
  {
    key: "orinoco_tracking",
    name: "Seguimiento de flotas Orinoco",
    status: "PROPUESTA",
    clients: [["logistica_orinoco", "Contratante"]],
    tech: ["python", "fastapi", "postgresql", "google_cloud"],
    target: 120,
    summary: "Propuesta de plataforma de seguimiento de flotas con alertas de ruta.",
    links: [["DOCUMENTACION", "Borrador de alcance"]],
  },
  {
    key: "tornillo_tienda",
    name: "Tienda en línea El Tornillo",
    status: "EN_CURSO",
    clients: [["ferreteria_el_tornillo", "Contratante"]],
    tech: ["shopify"],
    start: -30,
    target: 30,
    summary: "Catálogo y tienda en línea para la ferretería, con retiro en sucursal.",
    links: [
      ["ENTORNO", "Tienda de pruebas"],
      ["DISENO", "Tema personalizado"],
    ],
  },
  {
    key: "espiga_web",
    name: "Sitio Panadería La Espiga",
    status: "ENTREGADO",
    clients: [["panaderia_la_espiga", "Contratante"]],
    tech: ["wordpress", "php"],
    start: -260,
    target: -200,
    end: -190,
    summary: "Sitio informativo con menú, pedidos por WhatsApp y mapa de sucursales.",
    links: [["ENTORNO", "Producción"]],
  },
  {
    key: "roraima_portal",
    name: "Portal de obras Roraima",
    status: "CANCELADO",
    clients: [["constructora_roraima", "Contratante"]],
    tech: ["angular", "java", "spring_boot", "postgresql"],
    start: -180,
    target: -30,
    summary: "Portal de seguimiento de obras, cancelado por reestructuración del cliente.",
    links: [["REPOSITORIO", "Código fuente"]],
  },
  {
    key: "andina_saas",
    name: "Plataforma SaaS Andina",
    status: "EN_CURSO",
    clients: [
      ["andina_software", "Contratante"],
      ["bogota_fintech", "Socio tecnológico"],
    ],
    tech: [
      "next_js",
      "typescript",
      "prisma",
      "postgresql",
      "stripe",
      "sentry",
      "playwright",
      "vitest",
    ],
    tags: ["internacional", "cliente_clave"],
    start: -100,
    target: 60,
    summary:
      "Plataforma SaaS de facturación recurrente desarrollada con Andina Software y Bogotá Fintech.",
    goal: "Lanzar una plataforma de suscripciones lista para el mercado andino.",
    scope: [
      "Planes y suscripciones",
      "Cobros con Stripe",
      "Panel de administración",
      "Pruebas E2E",
    ],
    links: [
      ["REPOSITORIO", "Monorepo"],
      ["ENTORNO", "Staging"],
      ["GESTION", "Tablero"],
      ["DOCUMENTACION", "Guía de integración"],
    ],
  },
  {
    key: "harbor_asistente",
    name: "Asistente de IA Harbor Point",
    status: "EN_CURSO",
    clients: [["harbor_point", "Contratante"]],
    tech: ["python", "fastapi", "openai_api", "claude"],
    tags: ["internacional", "piloto"],
    start: -35,
    target: 45,
    summary:
      "Asistente conversacional para consultas internas, con búsqueda sobre documentos del cliente.",
    links: [
      ["REPOSITORIO", "Servicio de IA"],
      ["DOCUMENTACION", "Notas de evaluación"],
    ],
  },
  {
    key: "redwood_dashboard",
    name: "Dashboard de inversionistas Redwood",
    status: "ENTREGADO",
    clients: [["redwood_ventures", "Contratante"]],
    tech: ["react", "typescript", "graphql", "node_js"],
    tags: ["internacional"],
    start: -140,
    target: -20,
    end: -15,
    summary: "Panel de métricas del portafolio para los socios inversionistas de Redwood.",
    links: [
      ["REPOSITORIO", "Código fuente"],
      ["DISENO", "Sistema de diseño"],
    ],
  },
  {
    key: "olivar_app",
    name: "App Olivar Digital",
    status: "MANTENIMIENTO",
    clients: [["olivar_digital", "Contratante"]],
    tech: ["flutter", "supabase"],
    tags: ["mantenimiento", "recurrente"],
    start: -210,
    target: -120,
    end: -110,
    summary: "App de pedidos de aceite y conservas, en mantenimiento evolutivo.",
    links: [
      ["ENTORNO", "Panel de Supabase"],
      ["COMUNICACION", "Canal del cliente"],
    ],
  },
  {
    key: "mediterraneo_crm",
    name: "CRM Taller Mediterráneo",
    status: "PROPUESTA",
    clients: [["taller_mediterraneo", "Contratante"]],
    tech: ["django", "python", "postgresql"],
    target: 150,
    summary: "Propuesta de CRM para seguimiento de presupuestos y reparaciones.",
  },
  {
    key: "tlaloc_ruteo",
    name: "Ruteo de entregas Tláloc",
    status: "EN_CURSO",
    clients: [
      ["tlaloc_logistica", "Contratante"],
      ["cantera_estudio", "Diseño de producto"],
    ],
    tech: ["next_js", "typescript", "mongodb", "google_cloud"],
    start: -55,
    target: 14,
    summary: "Optimización de rutas de entrega con panel para despachadores.",
    links: [
      ["REPOSITORIO", "Código fuente"],
      ["DISENO", "Prototipo"],
      ["ENTORNO", "Staging"],
    ],
  },
  {
    key: "pampa_panel",
    name: "Panel Pampa Cloud",
    status: "EN_CURSO",
    clients: [["pampa_cloud", "Contratante"]],
    tech: ["vue_js", "node_js", "aws", "docker", "github_actions"],
    start: -20,
    target: 70,
    summary: "Panel de administración de recursos en la nube para los clientes de Pampa Cloud.",
    links: [
      ["REPOSITORIO", "Código fuente"],
      ["INFRAESTRUCTURA", "Pipeline de despliegue"],
    ],
  },
  {
    key: "andespay_movil",
    name: "Andes Pay móvil",
    status: "PAUSADO",
    clients: [["andes_pay", "Contratante"]],
    tech: ["react_native", "expo", "typescript"],
    start: -80,
    target: 90,
    summary: "App de pagos entre personas, en pausa mientras se obtiene la licencia regulatoria.",
    links: [["REPOSITORIO", "App móvil"]],
  },
  {
    key: "canal_portal",
    name: "Portal Canal Seguro",
    status: "ENTREGADO",
    clients: [
      ["canal_seguro", "Contratante"],
      ["istmo_trading", "Cliente final"],
    ],
    tech: ["angular", "nestjs", "postgresql"],
    start: -170,
    target: -65,
    end: -60,
    summary: "Portal de gestión de pólizas compartido por Canal Seguro e Istmo Trading.",
    links: [
      ["REPOSITORIO", "Código fuente"],
      ["DOCUMENTACION", "Manual de usuario"],
    ],
  },
  {
    key: "quito_solar_sitio",
    name: "Sitio Quito Solar",
    status: "CANCELADO",
    clients: [["quito_solar", "Contratante"]],
    tech: ["wordpress"],
    start: -90,
    target: -20,
    summary: "Sitio institucional cancelado antes del lanzamiento por cambio de proveedor.",
  },
  {
    key: "inti_iot",
    name: "Sensores Inti Agro",
    status: "PROPUESTA",
    clients: [
      ["inti_agro", "Contratante"],
      ["machu_retail", "Comprador de cosecha"],
    ],
    tech: ["python", "mongodb", "aws"],
    target: 180,
    summary:
      "Propuesta de plataforma IoT para monitorear cultivos y compartir cosechas con el comprador.",
    links: [["DOCUMENTACION", "Borrador de propuesta"]],
  },
  {
    key: "herrera_portafolio",
    name: "Portafolio Luis Herrera",
    status: "ENTREGADO",
    clients: [["luis_herrera", null]],
    tech: ["next_js", "typescript", "tailwind_css", "netlify"],
    start: -130,
    target: -105,
    end: -100,
    summary: "Portafolio personal de un fotógrafo, con galerías y formulario de contacto.",
    links: [["ENTORNO", "Producción"]],
  },
  {
    key: "whitfield_mvp",
    name: "MVP Jordan Whitfield",
    status: "EN_CURSO",
    clients: [["jordan_whitfield", "Fundador"]],
    tech: ["react", "supabase", "stripe"],
    tags: ["internacional", "piloto"],
    start: -12,
    target: 50,
    summary: "Producto mínimo viable de un marketplace de servicios para freelancers.",
    links: [
      ["REPOSITORIO", "Código fuente"],
      ["GESTION", "Roadmap"],
    ],
  },
  {
    key: "titan_app",
    name: "App Titán Fit",
    status: "PROPUESTA",
    clients: [["gimnasio_titan", "Contratante"]],
    tech: ["flutter"],
    target: 100,
    summary: "Propuesta de app para reservar clases y seguir rutinas de entrenamiento.",
  },
  {
    key: "veredas_landing",
    name: "Landing Veredas Digital",
    status: "ENTREGADO",
    clients: [["veredas_digital", "Contratante"]],
    tech: ["wordpress"],
    start: -240,
    target: -200,
    end: -195,
    summary: "Página de aterrizaje de campaña, archivada junto con su cliente.",
    archived: true,
  },
];

// ───────────────────────────── Factory ─────────────────────────────

function dateAt(today: DateOnly, offset: number | undefined): DateOnly | null {
  return offset === undefined ? null : addDays(today, offset);
}

/** ISO timestamp for the noon (UTC) of the date-only value, clamped to `now`. */
function stamp(day: DateOnly, now: Date, hour = 15): string {
  const value = `${day}T${String(hour).padStart(2, "0")}:00:00.000Z`;
  return Date.parse(value) > now.getTime() ? now.toISOString() : value;
}

/** Fresh project rows; dates are relative to `now` (store build time, Caracas business day). */
export function createProjectFixtures(now: Date): ProjectRow[] {
  const today = todayInCaracas(now);
  return SEEDS.map((seed, index): ProjectRow => {
    const startDate = dateAt(today, seed.start);
    const createdDay = addDays(startDate ?? addDays(today, -20 - index), startDate ? -7 : 0);
    const createdAt = stamp(createdDay, now);
    const lastEdit = addDays(today, -Math.min(30, 3 + index));
    const updatedAt = stamp(lastEdit > createdDay ? lastEdit : createdDay, now);
    const archivedAt = seed.archived ? stamp(addDays(today, -20), now, 16) : null;
    const perGroup = new Map<ProjectLinkGroup, number>();
    return {
      id: mockId("pry", seed.key),
      code: `PRY-${String(index + 1).padStart(4, "0")}`,
      name: seed.name,
      summary: seed.summary,
      description: seed.goal ? description(seed.goal, seed.scope ?? []) : null,
      status: seed.status,
      startDate,
      targetEndDate: dateAt(today, seed.target),
      endDate: dateAt(today, seed.end),
      clients: seed.clients.map(([clientKey, role]) => ({
        clientId: mockId("cli", clientKey),
        role,
      })),
      technologyIds: seed.tech.map((tech) => mockId("tec", tech)),
      tagIds: (seed.tags ?? []).map((tag) => mockId("tag", tag)),
      links: (seed.links ?? []).map(([group, label], position) => {
        const order = perGroup.get(group) ?? 0;
        perGroup.set(group, order + 1);
        return {
          id: mockId("plk", `${seed.key}_${position + 1}`),
          group,
          label,
          url: `https://${group.toLowerCase()}.example.com/${seed.key.replaceAll("_", "-")}/${position + 1}`,
          order,
        };
      }),
      createdAt,
      updatedAt: archivedAt ?? updatedAt,
      archivedAt,
      deletedById: archivedAt ? ARCHIVER_ID : null,
    };
  });
}
