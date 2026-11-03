/**
 * Every enum of PRD §10.2 (plus the Δ2 `ShareEvent` values) as `as const` tuples. The parity test of
 * package 3.1 checks them value by value against the generated Prisma client.
 */

export const USER_ROLE_VALUES = ['OWNER', 'ADMIN', 'MEMBER', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLE_VALUES)[number];

export const CLIENT_KIND_VALUES = ['PERSONA', 'EMPRESA'] as const;
export type ClientKind = (typeof CLIENT_KIND_VALUES)[number];

export const CLIENT_STATUS_VALUES = ['PROSPECTO', 'ACTIVO', 'INACTIVO'] as const;
export type ClientStatus = (typeof CLIENT_STATUS_VALUES)[number];

export const PROJECT_STATUS_VALUES = [
  'PROPUESTA',
  'EN_CURSO',
  'PAUSADO',
  'ENTREGADO',
  'MANTENIMIENTO',
  'CANCELADO',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUS_VALUES)[number];

export const PROJECT_LINK_GROUP_VALUES = [
  'REPOSITORIO',
  'ENTORNO',
  'DISENO',
  'GESTION',
  'DOCUMENTACION',
  'INFRAESTRUCTURA',
  'COMUNICACION',
  'OTRO',
] as const;
export type ProjectLinkGroup = (typeof PROJECT_LINK_GROUP_VALUES)[number];

export const TECH_CATEGORY_VALUES = [
  'LENGUAJE',
  'FRONTEND',
  'BACKEND',
  'BASE_DE_DATOS',
  'INFRAESTRUCTURA',
  'MOBILE',
  'IA',
  'TESTING',
  'HERRAMIENTA',
  'OTRO',
] as const;
export type TechCategory = (typeof TECH_CATEGORY_VALUES)[number];

export const BILLING_MODEL_VALUES = ['PRECIO_FIJO', 'RECURRENTE', 'MIXTO'] as const;
export type BillingModel = (typeof BILLING_MODEL_VALUES)[number];

export const INSTALLMENT_KIND_VALUES = [
  'ANTICIPO',
  'HITO',
  'CUOTA',
  'FINAL',
  'RECURRENTE',
  'AJUSTE',
] as const;
export type InstallmentKind = (typeof INSTALLMENT_KIND_VALUES)[number];

export const INSTALLMENT_STATUS_VALUES = [
  'PENDIENTE',
  'FACTURADA',
  'COBRADA_PARCIAL',
  'COBRADA',
  'CANCELADA',
] as const;
export type InstallmentStatus = (typeof INSTALLMENT_STATUS_VALUES)[number];

export const FREQUENCY_VALUES = ['MENSUAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'] as const;
export type Frequency = (typeof FREQUENCY_VALUES)[number];

export const RECURRING_STATUS_VALUES = ['ACTIVO', 'PAUSADO', 'FINALIZADO'] as const;
export type RecurringStatus = (typeof RECURRING_STATUS_VALUES)[number];

export const INVOICE_STATUS_VALUES = [
  'BORRADOR',
  'EMITIDA',
  'PARCIAL',
  'PAGADA',
  'VENCIDA',
  'ANULADA',
] as const;
export type InvoiceStatus = (typeof INVOICE_STATUS_VALUES)[number];

export const PAYMENT_STATUS_VALUES = ['PENDIENTE_VERIFICACION', 'CONFIRMADO', 'ANULADO'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export const ACCOUNT_TYPE_VALUES = [
  'BANCO_NACIONAL',
  'BANCO_INTERNACIONAL',
  'BILLETERA_DIGITAL',
  'WALLET_CRIPTO',
  'EFECTIVO',
] as const;
export type AccountType = (typeof ACCOUNT_TYPE_VALUES)[number];

export const ACCOUNT_MOVEMENT_TYPE_VALUES = ['APORTE_CAPITAL', 'RETIRO_SOCIO', 'AJUSTE'] as const;
export type AccountMovementType = (typeof ACCOUNT_MOVEMENT_TYPE_VALUES)[number];

export const EXPENSE_STATUS_VALUES = ['PENDIENTE', 'PAGADO', 'ANULADO'] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUS_VALUES)[number];

export const DOCUMENT_STATUS_VALUES = [
  'BORRADOR',
  'EN_REVISION',
  'APROBADO',
  'ENVIADO',
  'FIRMADO',
  'VENCIDO',
  'ANULADO',
] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUS_VALUES)[number];

export const DOCUMENT_FORMAT_VALUES = ['MARKDOWN', 'ARCHIVO', 'ENLACE'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMAT_VALUES)[number];

export const FILE_STATUS_VALUES = ['PENDING', 'READY'] as const;
export type FileStatus = (typeof FILE_STATUS_VALUES)[number];

export const RATE_SOURCE_VALUES = ['MANUAL', 'BCV', 'OTRA'] as const;
export type RateSource = (typeof RATE_SOURCE_VALUES)[number];

/** `UNLOCK` and `UNLOCK_FAILED` are the Δ2 additions (portal access keys, DT-45). */
export const SHARE_EVENT_VALUES = ['VIEW', 'DOWNLOAD', 'UNLOCK', 'UNLOCK_FAILED'] as const;
export type ShareEvent = (typeof SHARE_EVENT_VALUES)[number];

export const ACTOR_TYPE_VALUES = ['USER', 'SYSTEM', 'PUBLIC'] as const;
export type ActorType = (typeof ACTOR_TYPE_VALUES)[number];

export const ENTITY_TYPE_VALUES = [
  'CLIENT',
  'CONTACT',
  'PROJECT',
  'INVOICE',
  'PAYMENT',
  'EXPENSE',
  'RECURRING_EXPENSE',
  'ACCOUNT',
  'TRANSFER',
  'ACCOUNT_MOVEMENT',
  'DOCUMENT',
  'NOTE',
  'FILE',
  'SHARE_LINK',
  'BILLING_PLAN',
  'INSTALLMENT',
  'RECURRING_CHARGE',
  'TAG',
  'SETTING',
  'USER',
  'PAYMENT_LINK',
  'API_TOKEN',
] as const;
export type EntityType = (typeof ENTITY_TYPE_VALUES)[number];

export const ACTIVITY_ACTION_VALUES = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'RESTORE',
  'STATUS_CHANGE',
  'LINK',
  'UNLINK',
  'UPLOAD',
  'VERSION_PUBLISH',
  'SHARE_CREATE',
  'SHARE_REVOKE',
  'ALLOCATE',
  'DEALLOCATE',
  'EXPORT',
  'LOGIN',
  'SETTINGS_CHANGE',
  'SYSTEM_JOB',
  'PORTAL_ACCESS',
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTION_VALUES)[number];
