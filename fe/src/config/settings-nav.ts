import {
  ArrowRightLeft,
  Building2,
  CreditCard,
  Cpu,
  DollarSign,
  FileText,
  FolderTree,
  Percent,
  SlidersHorizontal,
  Tags,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { can, type PermissionAction, type PermissionResource } from "@/server/auth/permissions";

/**
 * The sections of Configuración (PRD §8.15, routes per frontend-patterns §3). The settings layout builds its
 * navigation from this list and filters it with `can()` (C13: cosmetic here, the services enforce it).
 */
export interface SettingsSection {
  /** Route segment under `/settings/<slug>`. */
  slug: string;
  /** Key under `settings.nav` in the i18n namespace. */
  labelKey: string;
  icon: LucideIcon;
  /** `can()` check that shows the section; `null` for the signed-in user's own preferences. */
  permission: { action: PermissionAction; resource: PermissionResource } | null;
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    slug: "company",
    labelKey: "company",
    icon: Building2,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "users",
    labelKey: "users",
    icon: Users,
    permission: { action: "read", resource: "user" },
  },
  { slug: "preferences", labelKey: "preferences", icon: SlidersHorizontal, permission: null },
  {
    slug: "currencies",
    labelKey: "currencies",
    icon: DollarSign,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "rates",
    labelKey: "rates",
    icon: ArrowRightLeft,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "fiscal",
    labelKey: "fiscal",
    icon: Percent,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "payment-methods",
    labelKey: "paymentMethods",
    icon: CreditCard,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "technologies",
    labelKey: "technologies",
    icon: Cpu,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "document-types",
    labelKey: "documentTypes",
    icon: FileText,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "expense-categories",
    labelKey: "expenseCategories",
    icon: FolderTree,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "tags",
    labelKey: "tags",
    icon: Tags,
    permission: { action: "read", resource: "settings" },
  },
  {
    slug: "trash",
    labelKey: "trash",
    icon: Trash2,
    permission: { action: "read", resource: "trash" },
  },
];

/** Whether a user sees the section. Preferences need only a signed-in user; the rest follow `can()`. */
export function isSettingsSectionVisible(
  section: SettingsSection,
  user: Parameters<typeof can>[0],
): boolean {
  if (section.permission === null) return user !== null && user !== undefined;
  return can(user, section.permission.action, section.permission.resource);
}

export function findSettingsSection(slug: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.slug === slug);
}
