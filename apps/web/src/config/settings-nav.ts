import {
  ArrowRightLeft,
  Building2,
  CreditCard,
  Cpu,
  DollarSign,
  FileText,
  FolderTree,
  KeyRound,
  Percent,
  Plug,
  SlidersHorizontal,
  Tags,
  Trash2,
  Users,
  type LucideIcon,
} from "lucide-react";
import { can, type PermissionAction, type PermissionResource } from "@/lib/auth/permissions";
import type { Features } from "@/lib/features";

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
  /** Feature flags the section needs (DT-227); absent when it is always on. */
  feature?: (features: Features) => boolean;
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
  // Personal access tokens: every signed-in user manages their own (DT-189, DT-195).
  { slug: "api-tokens", labelKey: "apiTokens", icon: KeyRound, permission: null },
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
    slug: "integrations",
    labelKey: "integrations",
    icon: Plug,
    permission: { action: "read", resource: "settings" },
    // Only while Stripe or Binance is on (DT-227); the first deploy runs with both off.
    feature: (features) => features.stripe || features.binance,
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

/**
 * Whether a user sees the section. A section behind a feature flag is hidden while the flag is off; then
 * preferences need only a signed-in user and the rest follow `can()`.
 */
export function isSettingsSectionVisible(
  section: SettingsSection,
  user: Parameters<typeof can>[0],
  features: Features,
): boolean {
  if (section.feature && !section.feature(features)) return false;
  if (section.permission === null) return user !== null && user !== undefined;
  return can(user, section.permission.action, section.permission.resource);
}

export function findSettingsSection(slug: string): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.slug === slug);
}
