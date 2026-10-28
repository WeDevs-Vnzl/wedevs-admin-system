import {
  Building2,
  CircleDollarSign,
  Cpu,
  FileText,
  FolderKanban,
  Landmark,
  Receipt,
  StickyNote,
  Tag,
  User,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { GraphNodeType } from "@/lib/validators/graph";

// Color and icon per node type: the canvas, the minimap, the legend and the SVG/PNG export share them, so the
// legend always matches what is drawn. Fixed values (not theme tokens) so the export renders the same everywhere.

export const NODE_COLORS: Record<GraphNodeType, string> = {
  CLIENT: "#2563eb",
  CONTACT: "#0891b2",
  PROJECT: "#7c3aed",
  INVOICE: "#d97706",
  PAYMENT: "#16a34a",
  EXPENSE: "#dc2626",
  ACCOUNT: "#0d9488",
  DOCUMENT: "#4f46e5",
  NOTE: "#ca8a04",
  TECHNOLOGY: "#64748b",
  TAG: "#db2777",
};

export const NODE_ICONS: Record<GraphNodeType, LucideIcon> = {
  CLIENT: Building2,
  CONTACT: User,
  PROJECT: FolderKanban,
  INVOICE: Receipt,
  PAYMENT: CircleDollarSign,
  EXPENSE: Wallet,
  ACCOUNT: Landmark,
  DOCUMENT: FileText,
  NOTE: StickyNote,
  TECHNOLOGY: Cpu,
  TAG: Tag,
};

export const MORE_COLOR = "#94a3b8";
