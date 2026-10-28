"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import type { EnumName } from "@/lib/validators/enums";
import type {
  AccountMovementType,
  AccountType,
  ActorType,
  BillingModel,
  ClientKind,
  ClientStatus,
  DocumentFormat,
  DocumentStatus,
  EntityType,
  ExpenseStatus,
  FileStatus,
  Frequency,
  InstallmentKind,
  InstallmentStatus,
  InvoiceStatus,
  PaymentStatus,
  ProjectLinkGroup,
  ProjectStatus,
  RateSource,
  RecurringStatus,
  ShareEvent,
  TechCategory,
  UserRole,
  ActivityAction,
} from "@/lib/validators/enums";

export type StatusTone = "neutral" | "info" | "success" | "warning" | "danger";

// One entry per enum value (C8). The mapped type makes a missing or unknown value a type error.
type EnumValueMap = {
  UserRole: UserRole;
  ClientKind: ClientKind;
  ClientStatus: ClientStatus;
  ProjectStatus: ProjectStatus;
  ProjectLinkGroup: ProjectLinkGroup;
  TechCategory: TechCategory;
  BillingModel: BillingModel;
  InstallmentKind: InstallmentKind;
  InstallmentStatus: InstallmentStatus;
  Frequency: Frequency;
  RecurringStatus: RecurringStatus;
  InvoiceStatus: InvoiceStatus;
  PaymentStatus: PaymentStatus;
  AccountType: AccountType;
  AccountMovementType: AccountMovementType;
  ExpenseStatus: ExpenseStatus;
  DocumentStatus: DocumentStatus;
  DocumentFormat: DocumentFormat;
  FileStatus: FileStatus;
  RateSource: RateSource;
  ShareEvent: ShareEvent;
  ActorType: ActorType;
  EntityType: EntityType;
  ActivityAction: ActivityAction;
};

type ToneMap = { [K in EnumName]: Record<EnumValueMap[K], StatusTone> };

const TONES: ToneMap = {
  UserRole: { OWNER: "neutral", ADMIN: "neutral", MEMBER: "neutral", VIEWER: "neutral" },
  ClientKind: { PERSONA: "neutral", EMPRESA: "neutral" },
  ClientStatus: { PROSPECTO: "info", ACTIVO: "success", INACTIVO: "neutral" },
  ProjectStatus: {
    PROPUESTA: "info",
    EN_CURSO: "success",
    PAUSADO: "warning",
    ENTREGADO: "neutral",
    MANTENIMIENTO: "info",
    CANCELADO: "danger",
  },
  ProjectLinkGroup: {
    REPOSITORIO: "neutral",
    ENTORNO: "neutral",
    DISENO: "neutral",
    GESTION: "neutral",
    DOCUMENTACION: "neutral",
    INFRAESTRUCTURA: "neutral",
    COMUNICACION: "neutral",
    OTRO: "neutral",
  },
  TechCategory: {
    LENGUAJE: "neutral",
    FRONTEND: "neutral",
    BACKEND: "neutral",
    BASE_DE_DATOS: "neutral",
    INFRAESTRUCTURA: "neutral",
    MOBILE: "neutral",
    IA: "neutral",
    TESTING: "neutral",
    HERRAMIENTA: "neutral",
    OTRO: "neutral",
  },
  BillingModel: { PRECIO_FIJO: "neutral", RECURRENTE: "neutral", MIXTO: "neutral" },
  InstallmentKind: {
    ANTICIPO: "neutral",
    HITO: "neutral",
    CUOTA: "neutral",
    FINAL: "neutral",
    RECURRENTE: "neutral",
    AJUSTE: "neutral",
  },
  InstallmentStatus: {
    PENDIENTE: "warning",
    FACTURADA: "info",
    COBRADA_PARCIAL: "neutral",
    COBRADA: "success",
    CANCELADA: "neutral",
  },
  Frequency: { MENSUAL: "neutral", TRIMESTRAL: "neutral", SEMESTRAL: "neutral", ANUAL: "neutral" },
  RecurringStatus: { ACTIVO: "success", PAUSADO: "warning", FINALIZADO: "neutral" },
  InvoiceStatus: {
    BORRADOR: "neutral",
    EMITIDA: "info",
    PARCIAL: "neutral",
    PAGADA: "success",
    VENCIDA: "danger",
    ANULADA: "neutral",
  },
  PaymentStatus: {
    PENDIENTE_VERIFICACION: "warning",
    CONFIRMADO: "success",
    ANULADO: "neutral",
  },
  AccountType: {
    BANCO_NACIONAL: "neutral",
    BANCO_INTERNACIONAL: "neutral",
    BILLETERA_DIGITAL: "neutral",
    WALLET_CRIPTO: "neutral",
    EFECTIVO: "neutral",
  },
  AccountMovementType: { APORTE_CAPITAL: "neutral", RETIRO_SOCIO: "neutral", AJUSTE: "neutral" },
  ExpenseStatus: { PENDIENTE: "warning", PAGADO: "success", ANULADO: "neutral" },
  DocumentStatus: {
    BORRADOR: "neutral",
    EN_REVISION: "info",
    APROBADO: "success",
    ENVIADO: "info",
    FIRMADO: "success",
    VENCIDO: "danger",
    ANULADO: "neutral",
  },
  DocumentFormat: { MARKDOWN: "neutral", ARCHIVO: "neutral", ENLACE: "neutral" },
  FileStatus: { PENDING: "warning", READY: "success" },
  RateSource: { MANUAL: "neutral", BCV: "neutral", OTRA: "neutral" },
  ShareEvent: { VIEW: "info", DOWNLOAD: "info", UNLOCK: "success", UNLOCK_FAILED: "danger" },
  ActorType: { USER: "neutral", SYSTEM: "neutral", PUBLIC: "neutral" },
  EntityType: {
    CLIENT: "neutral",
    CONTACT: "neutral",
    PROJECT: "neutral",
    INVOICE: "neutral",
    PAYMENT: "neutral",
    EXPENSE: "neutral",
    RECURRING_EXPENSE: "neutral",
    ACCOUNT: "neutral",
    TRANSFER: "neutral",
    ACCOUNT_MOVEMENT: "neutral",
    DOCUMENT: "neutral",
    NOTE: "neutral",
    FILE: "neutral",
    SHARE_LINK: "neutral",
    BILLING_PLAN: "neutral",
    INSTALLMENT: "neutral",
    RECURRING_CHARGE: "neutral",
    TAG: "neutral",
    SETTING: "neutral",
    USER: "neutral",
  },
  ActivityAction: {
    CREATE: "neutral",
    UPDATE: "neutral",
    DELETE: "danger",
    RESTORE: "neutral",
    STATUS_CHANGE: "neutral",
    LINK: "neutral",
    UNLINK: "neutral",
    UPLOAD: "neutral",
    VERSION_PUBLISH: "neutral",
    SHARE_CREATE: "neutral",
    SHARE_REVOKE: "neutral",
    ALLOCATE: "neutral",
    DEALLOCATE: "neutral",
    EXPORT: "neutral",
    LOGIN: "neutral",
    SETTINGS_CHANGE: "neutral",
    SYSTEM_JOB: "neutral",
    PORTAL_ACCESS: "neutral",
  },
};

// Values that also show the secondary "Pago parcial" indicator (frontend-patterns §9.4).
const PARTIAL_VALUES: ReadonlySet<string> = new Set(["PARCIAL", "COBRADA_PARCIAL"]);

const TONE_CLASS: Record<StatusTone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  warning:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  danger:
    "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
};

type StatusBadgeProps = {
  [K in EnumName]: { enumName: K; value: EnumValueMap[K] };
}[EnumName] & { className?: string };

// Renders one enum value as a toned badge with its `enums.<EnumName>.<VALUE>` label (C1).
export function StatusBadge({ enumName, value, className }: StatusBadgeProps) {
  const t = useTranslations("enums");
  const tp = useTranslations("patterns.statusBadge");
  const tone = (TONES[enumName] as Record<string, StatusTone>)[value] ?? "neutral";
  const partial = PARTIAL_VALUES.has(value);

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge variant="outline" className={`${TONE_CLASS[tone]} ${className ?? ""}`}>
        {t(`${enumName}.${value}`)}
      </Badge>
      {partial ? (
        <Badge variant="outline" className={TONE_CLASS.neutral}>
          {tp("partial")}
        </Badge>
      ) : null}
    </span>
  );
}

export const STATUS_TONES = TONES;
