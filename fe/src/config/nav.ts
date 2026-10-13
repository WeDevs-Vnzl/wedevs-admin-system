import {
  Banknote,
  Building2,
  ChartColumn,
  CreditCard,
  FileText,
  FolderKanban,
  History,
  LayoutDashboard,
  Landmark,
  Network,
  Plus,
  Receipt,
  Settings,
  StickyNote,
  type LucideIcon,
} from "lucide-react";
import {
  can,
  type PermissionAction,
  type PermissionResource,
  type PermissionSubject,
} from "@/server/auth/permissions";

// Single source of the navigation (PRD §7.1, frontend-patterns §2): sidebar, breadcrumbs and the Cmd+K
// dialog all read from here. Labels are i18n keys (`nav.items.<key>`, `search.actions.<key>`), icons follow
// frontend-patterns §1a. `resource` is the `can()` resource that hides the entry (cosmetic, C13); `null`
// means every signed-in role sees it (the dashboard shows a version without financial data, PRD §11).

export interface NavItem {
  /** Key under `nav.items` (and the `nav.segments` breadcrumb of the same route, when it has one). */
  key: string;
  href: string;
  icon: LucideIcon;
  resource: PermissionResource | null;
}

export interface NavGroup {
  /** Key under `nav.groups`; `null` for the ungrouped first entry. */
  key: string | null;
  items: readonly NavItem[];
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    key: null,
    items: [{ key: "dashboard", href: "/dashboard", icon: LayoutDashboard, resource: null }],
  },
  {
    key: "commercial",
    items: [
      { key: "clients", href: "/clients", icon: Building2, resource: "client" },
      { key: "projects", href: "/projects", icon: FolderKanban, resource: "project" },
    ],
  },
  {
    key: "finance",
    items: [
      { key: "invoices", href: "/invoices", icon: Receipt, resource: "invoice" },
      { key: "payments", href: "/payments", icon: Banknote, resource: "payment" },
      { key: "expenses", href: "/expenses", icon: CreditCard, resource: "expense" },
      { key: "accounts", href: "/accounts", icon: Landmark, resource: "account" },
    ],
  },
  {
    key: "knowledge",
    items: [
      { key: "documents", href: "/documents", icon: FileText, resource: "document" },
      { key: "notes", href: "/notes", icon: StickyNote, resource: "note" },
    ],
  },
  {
    key: "analysis",
    items: [
      { key: "graph", href: "/graph", icon: Network, resource: null },
      { key: "reports", href: "/reports", icon: ChartColumn, resource: "report" },
      { key: "activity", href: "/activity", icon: History, resource: "activity" },
    ],
  },
];

/**
 * The configuration entry pinned to the sidebar footer; its sections live in `settings-nav.ts`. `resource` is
 * null so every signed-in role sees the entry: the settings frame filters its sections with `can()` and each
 * role lands on Preferencias, its own preferences (PRD §8.15 "por usuario", M1).
 */
export const SETTINGS_NAV_ITEM: NavItem = {
  key: "settings",
  href: "/settings",
  icon: Settings,
  resource: null,
};

/** Whether `user` may see a nav entry (its `resource` is null or readable). */
export function isNavItemVisible(
  item: NavItem,
  user: PermissionSubject | null | undefined,
): boolean {
  return item.resource === null || can(user, "read", item.resource);
}

/** The groups of the sidebar that `user` may see, without empty groups. */
export function visibleNavGroups(user: PermissionSubject | null | undefined): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isNavItemVisible(item, user)),
  })).filter((group) => group.items.length > 0);
}

/** Every entry the Cmd+K navigation offers (the visible sidebar entries plus configuration). */
export function visibleNavItems(user: PermissionSubject | null | undefined): NavItem[] {
  const items = visibleNavGroups(user).flatMap((group) => group.items);
  return isNavItemVisible(SETTINGS_NAV_ITEM, user) ? [...items, SETTINGS_NAV_ITEM] : items;
}

export interface QuickAction {
  /** Key under `search.actions`. */
  key: string;
  href: string;
  icon: LucideIcon;
  /** `can()` action and resource that gate the entry (DT-66 vocabulary). */
  action: PermissionAction;
  resource: PermissionResource;
}

export const QUICK_ACTIONS: readonly QuickAction[] = [
  { key: "newClient", href: "/clients/new", icon: Plus, action: "create", resource: "client" },
  { key: "newProject", href: "/projects/new", icon: Plus, action: "create", resource: "project" },
  { key: "newInvoice", href: "/invoices/new", icon: Plus, action: "create", resource: "invoice" },
  { key: "newPayment", href: "/payments/new", icon: Plus, action: "create", resource: "payment" },
  { key: "newExpense", href: "/expenses/new", icon: Plus, action: "create", resource: "expense" },
  { key: "newNote", href: "/notes/new", icon: Plus, action: "create", resource: "note" },
  {
    key: "newDocument",
    href: "/documents/new",
    icon: Plus,
    action: "create",
    resource: "document",
  },
];

/** The quick actions `user` may run. */
export function visibleQuickActions(user: PermissionSubject | null | undefined): QuickAction[] {
  return QUICK_ACTIONS.filter((action) => can(user, action.action, action.resource));
}

/** Finds the nav entry whose route is the longest prefix of `pathname` (breadcrumbs, active state). */
export function findNavItem(pathname: string): NavItem | null {
  const all = [...NAV_GROUPS.flatMap((group) => group.items), SETTINGS_NAV_ITEM];
  const candidates = all.filter(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );
  return candidates.sort((a, b) => b.href.length - a.href.length)[0] ?? null;
}
