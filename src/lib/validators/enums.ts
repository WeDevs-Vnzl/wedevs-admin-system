import { z } from "./zod";

/**
 * Mirrors the Prisma enums of PRD §10.2 value by value (C8), plus the approved delta of
 * data-rules.md §3a Δ2 (`ShareEvent` + `UNLOCK`, `UNLOCK_FAILED`). Values stay as written in the PRD
 * (Spanish domain values included): never translate or rename them. Labels live in the `enums` i18n
 * namespace (`enums.<EnumName>.<VALUE>`).
 *
 * Each enum exports a `const` tuple (`<NAME>_VALUES`), a `z.enum` schema (`<name>Schema`) and the TS type.
 */

export const USER_ROLE_VALUES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export const userRoleSchema = z.enum(USER_ROLE_VALUES);
export type UserRole = z.infer<typeof userRoleSchema>;

export const CLIENT_KIND_VALUES = ["PERSONA", "EMPRESA"] as const;
export const clientKindSchema = z.enum(CLIENT_KIND_VALUES);
export type ClientKind = z.infer<typeof clientKindSchema>;

export const CLIENT_STATUS_VALUES = ["PROSPECTO", "ACTIVO", "INACTIVO"] as const;
export const clientStatusSchema = z.enum(CLIENT_STATUS_VALUES);
export type ClientStatus = z.infer<typeof clientStatusSchema>;

export const PROJECT_STATUS_VALUES = [
  "PROPUESTA",
  "EN_CURSO",
  "PAUSADO",
  "ENTREGADO",
  "MANTENIMIENTO",
  "CANCELADO",
] as const;
export const projectStatusSchema = z.enum(PROJECT_STATUS_VALUES);
export type ProjectStatus = z.infer<typeof projectStatusSchema>;

export const PROJECT_LINK_GROUP_VALUES = [
  "REPOSITORIO",
  "ENTORNO",
  "DISENO",
  "GESTION",
  "DOCUMENTACION",
  "INFRAESTRUCTURA",
  "COMUNICACION",
  "OTRO",
] as const;
export const projectLinkGroupSchema = z.enum(PROJECT_LINK_GROUP_VALUES);
export type ProjectLinkGroup = z.infer<typeof projectLinkGroupSchema>;

export const TECH_CATEGORY_VALUES = [
  "LENGUAJE",
  "FRONTEND",
  "BACKEND",
  "BASE_DE_DATOS",
  "INFRAESTRUCTURA",
  "MOBILE",
  "IA",
  "TESTING",
  "HERRAMIENTA",
  "OTRO",
] as const;
export const techCategorySchema = z.enum(TECH_CATEGORY_VALUES);
export type TechCategory = z.infer<typeof techCategorySchema>;

export const BILLING_MODEL_VALUES = ["PRECIO_FIJO", "RECURRENTE", "MIXTO"] as const;
export const billingModelSchema = z.enum(BILLING_MODEL_VALUES);
export type BillingModel = z.infer<typeof billingModelSchema>;

export const INSTALLMENT_KIND_VALUES = [
  "ANTICIPO",
  "HITO",
  "CUOTA",
  "FINAL",
  "RECURRENTE",
  "AJUSTE",
] as const;
export const installmentKindSchema = z.enum(INSTALLMENT_KIND_VALUES);
export type InstallmentKind = z.infer<typeof installmentKindSchema>;

export const INSTALLMENT_STATUS_VALUES = [
  "PENDIENTE",
  "FACTURADA",
  "COBRADA_PARCIAL",
  "COBRADA",
  "CANCELADA",
] as const;
export const installmentStatusSchema = z.enum(INSTALLMENT_STATUS_VALUES);
export type InstallmentStatus = z.infer<typeof installmentStatusSchema>;

export const FREQUENCY_VALUES = ["MENSUAL", "TRIMESTRAL", "SEMESTRAL", "ANUAL"] as const;
export const frequencySchema = z.enum(FREQUENCY_VALUES);
export type Frequency = z.infer<typeof frequencySchema>;

export const RECURRING_STATUS_VALUES = ["ACTIVO", "PAUSADO", "FINALIZADO"] as const;
export const recurringStatusSchema = z.enum(RECURRING_STATUS_VALUES);
export type RecurringStatus = z.infer<typeof recurringStatusSchema>;

export const INVOICE_STATUS_VALUES = [
  "BORRADOR",
  "EMITIDA",
  "PARCIAL",
  "PAGADA",
  "VENCIDA",
  "ANULADA",
] as const;
export const invoiceStatusSchema = z.enum(INVOICE_STATUS_VALUES);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

export const PAYMENT_STATUS_VALUES = ["PENDIENTE_VERIFICACION", "CONFIRMADO", "ANULADO"] as const;
export const paymentStatusSchema = z.enum(PAYMENT_STATUS_VALUES);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const ACCOUNT_TYPE_VALUES = [
  "BANCO_NACIONAL",
  "BANCO_INTERNACIONAL",
  "BILLETERA_DIGITAL",
  "WALLET_CRIPTO",
  "EFECTIVO",
] as const;
export const accountTypeSchema = z.enum(ACCOUNT_TYPE_VALUES);
export type AccountType = z.infer<typeof accountTypeSchema>;

export const ACCOUNT_MOVEMENT_TYPE_VALUES = ["APORTE_CAPITAL", "RETIRO_SOCIO", "AJUSTE"] as const;
export const accountMovementTypeSchema = z.enum(ACCOUNT_MOVEMENT_TYPE_VALUES);
export type AccountMovementType = z.infer<typeof accountMovementTypeSchema>;

export const EXPENSE_STATUS_VALUES = ["PENDIENTE", "PAGADO", "ANULADO"] as const;
export const expenseStatusSchema = z.enum(EXPENSE_STATUS_VALUES);
export type ExpenseStatus = z.infer<typeof expenseStatusSchema>;

export const DOCUMENT_STATUS_VALUES = [
  "BORRADOR",
  "EN_REVISION",
  "APROBADO",
  "ENVIADO",
  "FIRMADO",
  "VENCIDO",
  "ANULADO",
] as const;
export const documentStatusSchema = z.enum(DOCUMENT_STATUS_VALUES);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const DOCUMENT_FORMAT_VALUES = ["MARKDOWN", "ARCHIVO", "ENLACE"] as const;
export const documentFormatSchema = z.enum(DOCUMENT_FORMAT_VALUES);
export type DocumentFormat = z.infer<typeof documentFormatSchema>;

export const FILE_STATUS_VALUES = ["PENDING", "READY"] as const;
export const fileStatusSchema = z.enum(FILE_STATUS_VALUES);
export type FileStatus = z.infer<typeof fileStatusSchema>;

export const RATE_SOURCE_VALUES = ["MANUAL", "BCV", "OTRA"] as const;
export const rateSourceSchema = z.enum(RATE_SOURCE_VALUES);
export type RateSource = z.infer<typeof rateSourceSchema>;

export const SHARE_EVENT_VALUES = ["VIEW", "DOWNLOAD", "UNLOCK", "UNLOCK_FAILED"] as const;
export const shareEventSchema = z.enum(SHARE_EVENT_VALUES);
export type ShareEvent = z.infer<typeof shareEventSchema>;

export const ACTOR_TYPE_VALUES = ["USER", "SYSTEM", "PUBLIC"] as const;
export const actorTypeSchema = z.enum(ACTOR_TYPE_VALUES);
export type ActorType = z.infer<typeof actorTypeSchema>;

export const ENTITY_TYPE_VALUES = [
  "CLIENT",
  "CONTACT",
  "PROJECT",
  "INVOICE",
  "PAYMENT",
  "EXPENSE",
  "RECURRING_EXPENSE",
  "ACCOUNT",
  "TRANSFER",
  "ACCOUNT_MOVEMENT",
  "DOCUMENT",
  "NOTE",
  "FILE",
  "SHARE_LINK",
  "BILLING_PLAN",
  "INSTALLMENT",
  "RECURRING_CHARGE",
  "TAG",
  "SETTING",
  "USER",
] as const;
export const entityTypeSchema = z.enum(ENTITY_TYPE_VALUES);
export type EntityType = z.infer<typeof entityTypeSchema>;

export const ACTIVITY_ACTION_VALUES = [
  "CREATE",
  "UPDATE",
  "DELETE",
  "RESTORE",
  "STATUS_CHANGE",
  "LINK",
  "UNLINK",
  "UPLOAD",
  "VERSION_PUBLISH",
  "SHARE_CREATE",
  "SHARE_REVOKE",
  "ALLOCATE",
  "DEALLOCATE",
  "EXPORT",
  "LOGIN",
  "SETTINGS_CHANGE",
  "SYSTEM_JOB",
  "PORTAL_ACCESS",
] as const;
export const activityActionSchema = z.enum(ACTIVITY_ACTION_VALUES);
export type ActivityAction = z.infer<typeof activityActionSchema>;

/** Registry keyed by the Prisma enum name: drives the H2 enum-parity test and the i18n `enums` check. */
export const ENUM_REGISTRY = {
  UserRole: USER_ROLE_VALUES,
  ClientKind: CLIENT_KIND_VALUES,
  ClientStatus: CLIENT_STATUS_VALUES,
  ProjectStatus: PROJECT_STATUS_VALUES,
  ProjectLinkGroup: PROJECT_LINK_GROUP_VALUES,
  TechCategory: TECH_CATEGORY_VALUES,
  BillingModel: BILLING_MODEL_VALUES,
  InstallmentKind: INSTALLMENT_KIND_VALUES,
  InstallmentStatus: INSTALLMENT_STATUS_VALUES,
  Frequency: FREQUENCY_VALUES,
  RecurringStatus: RECURRING_STATUS_VALUES,
  InvoiceStatus: INVOICE_STATUS_VALUES,
  PaymentStatus: PAYMENT_STATUS_VALUES,
  AccountType: ACCOUNT_TYPE_VALUES,
  AccountMovementType: ACCOUNT_MOVEMENT_TYPE_VALUES,
  ExpenseStatus: EXPENSE_STATUS_VALUES,
  DocumentStatus: DOCUMENT_STATUS_VALUES,
  DocumentFormat: DOCUMENT_FORMAT_VALUES,
  FileStatus: FILE_STATUS_VALUES,
  RateSource: RATE_SOURCE_VALUES,
  ShareEvent: SHARE_EVENT_VALUES,
  ActorType: ACTOR_TYPE_VALUES,
  EntityType: ENTITY_TYPE_VALUES,
  ActivityAction: ACTIVITY_ACTION_VALUES,
} as const;

export type EnumName = keyof typeof ENUM_REGISTRY;
