// MOCK — catalog and settings fixtures of Hito 1 (data-rules.md §2, §9; PRD §10.4 seed). Fictitious data
// only (C5). The catalog rows mirror what `prisma/seed.ts` will seed in H2-B1; the exchange rates and the
// mock users are demo data. Deleted with `src/mocks/` at the close of Hito 2 (C9).
import { addDays, isBusinessDay, type DateOnly } from "@/lib/dates";
import { toDecimal } from "@/lib/money";
import type {
  CurrencyDTO,
  ExchangeRateDTO,
  ExpenseCategoryDTO,
  PaymentMethodDTO,
} from "@/lib/validators/catalogs";
import type { DocumentCategoryRefDTO, DocumentTypeRefDTO } from "@/lib/validators/document-types";
import type { DocumentFormat, RateSource, TechCategory } from "@/lib/validators/enums";
import {
  DEFAULT_FISCAL_SETTINGS,
  type CompanySettings,
  type FiscalSettings,
} from "@/lib/validators/settings";
import type { TagChipDTO } from "@/lib/validators/tags";
import type { TechnologyChipDTO } from "@/lib/validators/technologies";
import type { UserDetailDTO } from "@/lib/validators/users";
import { mockId } from "../ids";

// ───────────────────────────── Row types ─────────────────────────────

/** Category row: the picker DTO plus its position in Settings → Documentos. */
export type DocumentCategoryRow = DocumentCategoryRefDTO & { order: number };

/** Type row: the picker DTO plus its category and `active` flag. */
export type DocumentTypeRow = DocumentTypeRefDTO & { categoryId: string; active: boolean };

/** Technology row: the chip plus `active`. The usage count is derived from the projects. */
export type TechnologyRow = TechnologyChipDTO & { active: boolean };

/** Tag row: the chip plus its creation time. The usage count is derived from the assignments. */
export type TagRow = TagChipDTO & { createdAt: string };

export interface CatalogFixtures {
  currencies: CurrencyDTO[];
  exchangeRates: ExchangeRateDTO[];
  paymentMethods: PaymentMethodDTO[];
  documentCategories: DocumentCategoryRow[];
  documentTypes: DocumentTypeRow[];
  expenseCategories: ExpenseCategoryDTO[];
  technologies: TechnologyRow[];
  tags: TagRow[];
  fiscal: FiscalSettings;
  company: CompanySettings;
  users: UserDetailDTO[];
}

// ───────────────────────────── Users ─────────────────────────────

const USER_CREATED_AT = "2026-01-05T14:00:00.000Z";

/**
 * Mock users. The first two ids are the ones `@/mocks/session` signs in (kept in sync by a test); the
 * rest give the "created by" and "uploaded by" references other roles to point at.
 */
export const MOCK_USER_DETAILS: UserDetailDTO[] = [
  {
    id: "usr_andres_molina",
    name: "Andrés Molina",
    email: "andres.molina@example.com",
    imageUrl: null,
    role: "OWNER",
    locale: "es",
    theme: "system",
    createdAt: USER_CREATED_AT,
    updatedAt: USER_CREATED_AT,
  },
  {
    id: "usr_valeria_rojas",
    name: "Valeria Rojas",
    email: "valeria.rojas@example.com",
    imageUrl: null,
    role: "OWNER",
    locale: "es",
    theme: "system",
    createdAt: USER_CREATED_AT,
    updatedAt: USER_CREATED_AT,
  },
  {
    id: "usr_camila_torres",
    name: "Camila Torres",
    email: "camila.torres@example.com",
    imageUrl: null,
    role: "ADMIN",
    locale: "es",
    theme: "light",
    createdAt: USER_CREATED_AT,
    updatedAt: USER_CREATED_AT,
  },
  {
    id: "usr_diego_paredes",
    name: "Diego Paredes",
    email: "diego.paredes@example.com",
    imageUrl: null,
    role: "MEMBER",
    locale: "en",
    theme: "dark",
    createdAt: USER_CREATED_AT,
    updatedAt: USER_CREATED_AT,
  },
];

const RATE_AUTHOR_ID = "usr_valeria_rojas";

// ───────────────────────────── Currencies and payment methods ─────────────────────────────

export const CURRENCY_FIXTURES: CurrencyDTO[] = [
  { code: "USD", name: "Dólar estadounidense", symbol: "$", decimals: 2, active: true },
  { code: "VES", name: "Bolívar venezolano", symbol: "Bs.", decimals: 2, active: true },
  { code: "EUR", name: "Euro", symbol: "€", decimals: 2, active: true },
  { code: "USDT", name: "Tether (USDT)", symbol: "USDT", decimals: 2, active: true },
  { code: "COP", name: "Peso colombiano", symbol: "COL$", decimals: 2, active: true },
];

const method = (
  key: string,
  code: string,
  name: string,
  nameEn: string,
  requiresReference: boolean,
  suggestsIgtf: boolean,
): PaymentMethodDTO => ({
  id: mockId("pmt", key),
  code,
  name,
  nameEn,
  requiresReference,
  suggestsIgtf,
  active: true,
});

export const PAYMENT_METHOD_FIXTURES: PaymentMethodDTO[] = [
  method(
    "transferencia_nacional",
    "TRANSFERENCIA_NACIONAL",
    "Transferencia nacional",
    "Domestic transfer",
    true,
    false,
  ),
  method("pago_movil", "PAGO_MOVIL", "Pago Móvil", "Pago Móvil (mobile payment)", true, false),
  method(
    "transferencia_internacional",
    "TRANSFERENCIA_INTERNACIONAL",
    "Transferencia internacional",
    "International transfer",
    true,
    false,
  ),
  method("zelle", "ZELLE", "Zelle", "Zelle", true, true),
  method("zinli", "ZINLI", "Zinli", "Zinli", true, true),
  method("paypal", "PAYPAL", "PayPal", "PayPal", true, true),
  method("usdt_cripto", "USDT_CRIPTO", "USDT / Cripto", "USDT / Crypto", true, true),
  method("efectivo_usd", "EFECTIVO_USD", "Efectivo USD", "Cash USD", false, true),
  method("efectivo_ves", "EFECTIVO_VES", "Efectivo VES", "Cash VES", false, false),
  method("otro", "OTRO", "Otro", "Other", false, false),
];

// ───────────────────────────── Document categories and types (PRD §8.9.1) ─────────────────────────────

const docCategory = (
  key: string,
  order: number,
  name: string,
  nameEn: string,
  color: string,
): DocumentCategoryRow => ({ id: mockId("dcat", key), name, nameEn, color, order });

export const DOCUMENT_CATEGORY_FIXTURES: DocumentCategoryRow[] = [
  docCategory("legal", 0, "Legal", "Legal", "#6d28d9"),
  docCategory("comercial", 1, "Comercial", "Commercial", "#0369a1"),
  docCategory("tecnico", 2, "Técnico", "Technical", "#047857"),
  docCategory("operativo", 3, "Operativo", "Operations", "#b45309"),
  docCategory("financiero", 4, "Financiero", "Finance", "#be123c"),
];

const docType = (
  category: string,
  key: string,
  name: string,
  nameEn: string,
  defaultFormat: DocumentFormat,
  flags: { requiresSignature?: boolean; hasExpiration?: boolean } = {},
): DocumentTypeRow => ({
  id: mockId("dtyp", key),
  categoryId: mockId("dcat", category),
  name,
  nameEn,
  defaultFormat,
  requiresSignature: flags.requiresSignature ?? false,
  hasExpiration: flags.hasExpiration ?? false,
  active: true,
});

export const DOCUMENT_TYPE_FIXTURES: DocumentTypeRow[] = [
  docType("legal", "contrato_servicios", "Contrato de servicios", "Service agreement", "ARCHIVO", {
    requiresSignature: true,
    hasExpiration: true,
  }),
  docType(
    "legal",
    "nda",
    "Acuerdo de confidencialidad (NDA)",
    "Non-disclosure agreement (NDA)",
    "ARCHIVO",
    { requiresSignature: true, hasExpiration: true },
  ),
  docType("legal", "adenda", "Adenda", "Addendum", "ARCHIVO", { requiresSignature: true }),
  docType("legal", "acta_entrega", "Acta de entrega", "Delivery certificate", "ARCHIVO", {
    requiresSignature: true,
  }),
  docType(
    "legal",
    "cesion_pi",
    "Cesión de propiedad intelectual",
    "Intellectual property assignment",
    "ARCHIVO",
    { requiresSignature: true },
  ),
  docType("comercial", "propuesta", "Propuesta comercial", "Commercial proposal", "ARCHIVO", {
    hasExpiration: true,
  }),
  docType("comercial", "cotizacion", "Cotización", "Quote", "ARCHIVO", { hasExpiration: true }),
  docType("tecnico", "prd", "PRD", "PRD", "MARKDOWN"),
  docType("tecnico", "tsd", "TSD", "TSD", "MARKDOWN"),
  docType("tecnico", "roadmap", "Roadmap", "Roadmap", "MARKDOWN"),
  docType("tecnico", "arquitectura", "Arquitectura", "Architecture", "MARKDOWN"),
  docType("tecnico", "manual_usuario", "Manual de usuario", "User manual", "MARKDOWN"),
  docType("operativo", "minuta", "Minuta de reunión", "Meeting minutes", "MARKDOWN"),
  docType(
    "operativo",
    "credenciales",
    "Credenciales (enlace al gestor de contraseñas)",
    "Credentials (password manager link)",
    "ENLACE",
  ),
  docType("operativo", "onboarding", "Onboarding", "Onboarding", "MARKDOWN"),
  docType(
    "financiero",
    "comprobante_retencion",
    "Comprobante de retención",
    "Withholding certificate",
    "ARCHIVO",
  ),
  docType("financiero", "estado_cuenta", "Estado de cuenta", "Account statement", "ARCHIVO"),
];

// ───────────────────────────── Expense categories (PRD §8.8, two levels) ─────────────────────────────

const expenseRoot = (
  key: string,
  name: string,
  nameEn: string,
  color: string,
): ExpenseCategoryDTO => ({
  id: mockId("ecat", key),
  name,
  nameEn,
  color,
  parentId: null,
  active: true,
});

const expenseChild = (
  parent: string,
  key: string,
  name: string,
  nameEn: string,
): ExpenseCategoryDTO => ({
  id: mockId("ecat", key),
  name,
  nameEn,
  color: null,
  parentId: mockId("ecat", parent),
  active: true,
});

export const EXPENSE_CATEGORY_FIXTURES: ExpenseCategoryDTO[] = [
  expenseRoot("infraestructura", "Infraestructura", "Infrastructure", "#0369a1"),
  expenseChild("infraestructura", "hosting", "Hosting", "Hosting"),
  expenseChild("infraestructura", "bases_de_datos", "Bases de datos", "Databases"),
  expenseChild("infraestructura", "almacenamiento", "Almacenamiento y CDN", "Storage and CDN"),
  expenseRoot("software_saas", "Software y SaaS", "Software and SaaS", "#6d28d9"),
  expenseChild("software_saas", "diseno", "Herramientas de diseño", "Design tools"),
  expenseChild("software_saas", "gestion_proyectos", "Gestión de proyectos", "Project management"),
  expenseChild("software_saas", "comunicacion", "Comunicación", "Communication"),
  expenseRoot("ia", "IA", "AI", "#047857"),
  expenseChild("ia", "apis_modelos", "APIs de modelos", "Model APIs"),
  expenseChild("ia", "suscripciones_ia", "Suscripciones de IA", "AI subscriptions"),
  expenseRoot("dominios", "Dominios", "Domains", "#b45309"),
  expenseRoot("freelancers", "Freelancers", "Freelancers", "#be123c"),
  expenseChild("freelancers", "freelancers_desarrollo", "Desarrollo", "Development"),
  expenseChild("freelancers", "freelancers_diseno", "Diseño", "Design"),
  expenseRoot("comisiones_impuestos", "Comisiones e impuestos", "Fees and taxes", "#475569"),
  expenseChild("comisiones_impuestos", "comisiones_bancarias", "Comisiones bancarias", "Bank fees"),
  expenseChild("comisiones_impuestos", "impuestos", "Impuestos", "Taxes"),
  expenseRoot("oficina", "Oficina", "Office", "#0f766e"),
  expenseRoot("marketing", "Marketing", "Marketing", "#c2410c"),
  expenseRoot("legal_contable", "Legal y contable", "Legal and accounting", "#4338ca"),
  expenseRoot("otros", "Otros", "Other", "#64748b"),
];

// ───────────────────────────── Technologies (~60, PRD §10.4) ─────────────────────────────

/** `Next.js` → `next-js`, `C#` → `c-sharp`: the kebab slug the technology contract accepts. */
export function slugifyTechnology(name: string): string {
  return name
    .toLowerCase()
    .replaceAll("#", "-sharp")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// [name, category, Simple Icons slug]
const TECHNOLOGY_SOURCE: readonly (readonly [string, TechCategory, string])[] = [
  ["TypeScript", "LENGUAJE", "typescript"],
  ["JavaScript", "LENGUAJE", "javascript"],
  ["Python", "LENGUAJE", "python"],
  ["PHP", "LENGUAJE", "php"],
  ["Go", "LENGUAJE", "go"],
  ["Rust", "LENGUAJE", "rust"],
  ["Java", "LENGUAJE", "openjdk"],
  ["Kotlin", "LENGUAJE", "kotlin"],
  ["Swift", "LENGUAJE", "swift"],
  ["C#", "LENGUAJE", "csharp"],
  ["React", "FRONTEND", "react"],
  ["Next.js", "FRONTEND", "nextdotjs"],
  ["Vue.js", "FRONTEND", "vuedotjs"],
  ["Nuxt", "FRONTEND", "nuxtdotjs"],
  ["Angular", "FRONTEND", "angular"],
  ["Svelte", "FRONTEND", "svelte"],
  ["Tailwind CSS", "FRONTEND", "tailwindcss"],
  ["Vite", "FRONTEND", "vite"],
  ["Node.js", "BACKEND", "nodedotjs"],
  ["NestJS", "BACKEND", "nestjs"],
  ["Express", "BACKEND", "express"],
  ["Laravel", "BACKEND", "laravel"],
  ["Django", "BACKEND", "django"],
  ["FastAPI", "BACKEND", "fastapi"],
  ["Spring Boot", "BACKEND", "springboot"],
  ["Hono", "BACKEND", "hono"],
  ["PostgreSQL", "BASE_DE_DATOS", "postgresql"],
  ["MySQL", "BASE_DE_DATOS", "mysql"],
  ["MongoDB", "BASE_DE_DATOS", "mongodb"],
  ["Redis", "BASE_DE_DATOS", "redis"],
  ["SQLite", "BASE_DE_DATOS", "sqlite"],
  ["Prisma", "BASE_DE_DATOS", "prisma"],
  ["Supabase", "BASE_DE_DATOS", "supabase"],
  ["Docker", "INFRAESTRUCTURA", "docker"],
  ["Kubernetes", "INFRAESTRUCTURA", "kubernetes"],
  ["AWS", "INFRAESTRUCTURA", "amazonaws"],
  ["Google Cloud", "INFRAESTRUCTURA", "googlecloud"],
  ["Netlify", "INFRAESTRUCTURA", "netlify"],
  ["Vercel", "INFRAESTRUCTURA", "vercel"],
  ["Cloudflare", "INFRAESTRUCTURA", "cloudflare"],
  ["Neon", "INFRAESTRUCTURA", "neon"],
  ["GitHub Actions", "INFRAESTRUCTURA", "githubactions"],
  ["React Native", "MOBILE", "react"],
  ["Flutter", "MOBILE", "flutter"],
  ["Expo", "MOBILE", "expo"],
  ["OpenAI API", "IA", "openai"],
  ["Claude", "IA", "anthropic"],
  ["LangChain", "IA", "langchain"],
  ["Vitest", "TESTING", "vitest"],
  ["Playwright", "TESTING", "playwright"],
  ["Jest", "TESTING", "jest"],
  ["Git", "HERRAMIENTA", "git"],
  ["GitHub", "HERRAMIENTA", "github"],
  ["Figma", "HERRAMIENTA", "figma"],
  ["Storybook", "HERRAMIENTA", "storybook"],
  ["Clerk", "HERRAMIENTA", "clerk"],
  ["Stripe", "HERRAMIENTA", "stripe"],
  ["Sentry", "HERRAMIENTA", "sentry"],
  ["GraphQL", "OTRO", "graphql"],
  ["WordPress", "OTRO", "wordpress"],
  ["Shopify", "OTRO", "shopify"],
];

export const TECHNOLOGY_FIXTURES: TechnologyRow[] = TECHNOLOGY_SOURCE.map(
  ([name, category, iconSlug]) => {
    const slug = slugifyTechnology(name);
    return {
      id: mockId("tec", slug.replaceAll("-", "_")),
      name,
      nameEn: null,
      slug,
      category,
      iconSlug,
      color: null,
      active: true,
    };
  },
);

// ───────────────────────────── Tags ─────────────────────────────

const TAG_CREATED_AT = "2026-01-12T16:00:00.000Z";

const tag = (key: string, name: string, color: string): TagRow => ({
  id: mockId("tag", key),
  name,
  color,
  createdAt: TAG_CREATED_AT,
});

export const TAG_FIXTURES: TagRow[] = [
  tag("prioritario", "Prioritario", "#dc2626"),
  tag("cliente_clave", "Cliente clave", "#7c3aed"),
  tag("pendiente_firma", "Pendiente de firma", "#d97706"),
  tag("recurrente", "Recurrente", "#0891b2"),
  tag("mantenimiento", "Mantenimiento", "#059669"),
  tag("internacional", "Internacional", "#2563eb"),
  tag("piloto", "Piloto", "#db2777"),
  tag("urgente", "Urgente", "#b91c1c"),
];

// ───────────────────────────── Settings ─────────────────────────────

/** Fiscal parameters: IVA rates 16/8/0 with 16 as default, IGTF 3 %, invoices due in 15 days (PRD §10.4). */
export const FISCAL_FIXTURE: FiscalSettings = {
  ...DEFAULT_FISCAL_SETTINGS,
  ivaRates: [...DEFAULT_FISCAL_SETTINGS.ivaRates],
  igtfCurrencies: ["USD", "EUR", "USDT"],
  igtfMethodCodes: ["EFECTIVO_USD", "ZELLE", "ZINLI", "PAYPAL", "USDT_CRIPTO"],
};

export const COMPANY_FIXTURE: CompanySettings = {
  name: "WeDevs",
  legalName: "WeDevs Studio, C.A.",
  taxId: "J-00000000-0",
  address: "Av. Principal de Ejemplo, Torre Demo, piso 4, Caracas",
  logoFileId: undefined,
};

// ───────────────────────────── Exchange rates ─────────────────────────────

/** Days of rate history before today. */
export const RATE_HISTORY_DAYS = 90;

/** Business-day offset (0 = the latest) whose rates are missing, to exercise the "Usando tasa del…" fallback. */
export const MISSING_RATE_BUSINESS_DAY_OFFSET = 5;

/** VES per USD of the latest business day. */
export const LATEST_VES_RATE = "755.16";

const timestampOf = (date: DateOnly, time: string) => `${date}T${time}.000Z`;

function rateRow(
  date: DateOnly,
  currency: string,
  usdRate: string,
  source: RateSource,
  time: string,
): ExchangeRateDTO {
  return {
    id: mockId(
      "rte",
      `${date.replaceAll("-", "")}_${currency.toLowerCase()}_${source.toLowerCase()}`,
    ),
    date,
    currency,
    usdRate,
    source,
    createdAt: timestampOf(date, time),
    createdById: RATE_AUTHOR_ID,
  };
}

/**
 * Daily rates of the last ~90 days, business days only. `offset` counts business days back from the
 * latest one, so the VES BCV rate drifts down by a fixed step into the past from `755.16`. One business
 * day has no rates at all; the latest day also carries an `OTRA` VES rate, and a few older days a
 * `MANUAL` one, so the source selector (DT-67) has something to show. All arithmetic is decimal.
 */
/** `usdRate` of USDT: units per USD, from 1 USDT = 1.01 USD (1 / 1.01 rounded to 4 places). */
const USDT_PER_USD = "0.9901";

export function createExchangeRateFixtures(today: DateOnly): ExchangeRateDTO[] {
  const days: DateOnly[] = [];
  for (let back = 0; back <= RATE_HISTORY_DAYS; back += 1) {
    const date = addDays(today, -back);
    if (isBusinessDay(date)) days.push(date);
  }

  const rows: ExchangeRateDTO[] = [];
  days.forEach((date, offset) => {
    if (offset === MISSING_RATE_BUSINESS_DAY_OFFSET) return;

    const ves = toDecimal(LATEST_VES_RATE)
      .minus(toDecimal("0.42").times(offset))
      .plus(toDecimal("0.03").times((offset * 7) % 5));
    rows.push(rateRow(date, "VES", ves.toFixed(4), "BCV", "13:00:00"));
    if (offset === 0) {
      rows.push(rateRow(date, "VES", ves.plus("2.24").toFixed(4), "OTRA", "15:30:00"));
    }
    if (offset === 12 || offset === 30) {
      rows.push(rateRow(date, "VES", ves.plus("0.80").toFixed(4), "MANUAL", "16:10:00"));
    }

    const eur = toDecimal("0.86").plus(toDecimal("0.0004").times((offset * 3) % 7));
    rows.push(rateRow(date, "EUR", eur.toFixed(4), "MANUAL", "13:05:00"));
    const cop = toDecimal("4012.5").plus(toDecimal("3.1").times(offset % 9));
    rows.push(rateRow(date, "COP", cop.toFixed(2), "MANUAL", "13:05:00"));
    // 1 USDT = 1.01 USD, so a USD buys 1 / 1.01 USDT.
    rows.push(rateRow(date, "USDT", USDT_PER_USD, "MANUAL", "13:05:00"));
  });
  return rows;
}

// ───────────────────────────── Aggregate ─────────────────────────────

/** Builds fresh copies of every catalog fixture; `today` (Caracas) anchors the rate history. */
export function createCatalogFixtures(today: DateOnly): CatalogFixtures {
  return structuredClone({
    currencies: CURRENCY_FIXTURES,
    exchangeRates: createExchangeRateFixtures(today),
    paymentMethods: PAYMENT_METHOD_FIXTURES,
    documentCategories: DOCUMENT_CATEGORY_FIXTURES,
    documentTypes: DOCUMENT_TYPE_FIXTURES,
    expenseCategories: EXPENSE_CATEGORY_FIXTURES,
    technologies: TECHNOLOGY_FIXTURES,
    tags: TAG_FIXTURES,
    fiscal: FISCAL_FIXTURE,
    company: COMPANY_FIXTURE,
    users: MOCK_USER_DETAILS,
  });
}
