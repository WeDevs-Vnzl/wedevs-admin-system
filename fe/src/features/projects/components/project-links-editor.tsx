"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BookOpen,
  ChevronDown,
  ChevronUp,
  ClipboardList,
  Cloud,
  Copy,
  ExternalLink,
  GitBranch,
  GripVertical,
  Link2,
  MessageSquare,
  Palette,
  Plus,
  Server,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { ProjectLinkGroup } from "@/lib/validators/enums";
import { VALIDATION_MESSAGES } from "@/lib/validators/common";
import { projectLinkInputSchema } from "@/lib/validators/projects";
import { httpUrlSchema } from "@/lib/validators/tags";
import {
  LINK_GROUPS,
  addLink,
  faviconUrl,
  groupRows,
  moveLink,
  removeLink,
  reorderWithinGroup,
  type ProjectLinkRow,
} from "../link-rows";

/** The icon of each group: the favicon fallback (HU-07). */
const GROUP_ICONS: Record<ProjectLinkGroup, LucideIcon> = {
  REPOSITORIO: GitBranch,
  ENTORNO: Server,
  DISENO: Palette,
  GESTION: ClipboardList,
  DOCUMENTACION: BookOpen,
  INFRAESTRUCTURA: Cloud,
  COMUNICACION: MessageSquare,
  OTRO: Link2,
};

export interface ProjectLinksEditorProps {
  rows: ProjectLinkRow[];
  /** Every change goes up as the next list of rows; the caller decides how to save it. */
  onChange?: (rows: ProjectLinkRow[]) => void;
  /** Add, edit and remove rows (Owner, Admin, Member on the project form). */
  editable?: boolean;
  /** Drag and keyboard reorder inside a group (the detail page persists it). */
  reorderable?: boolean;
}

let keyCounter = 0;
/** Local key of a link that is not saved yet. */
function nextKey(): string {
  keyCounter += 1;
  return `new-${keyCounter}`;
}

/** Field errors of one row, as i18n keys (the schema of `upsertProjectLinksAction`). */
function rowErrors(row: ProjectLinkRow): { label?: string; url?: string } {
  const parsed = projectLinkInputSchema.safeParse({
    id: row.id,
    group: row.group,
    label: row.label,
    url: row.url,
    order: row.order,
  });
  if (parsed.success) return {};
  const errors: { label?: string; url?: string } = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0];
    if ((field === "label" || field === "url") && !errors[field]) errors[field] = issue.message;
  }
  return errors;
}

/** Whether a URL the user typed is a valid `http(s)` link (HU-07 CA3). */
function isValidUrl(url: string): boolean {
  return httpUrlSchema.safeParse(url).success;
}

/**
 * Links of a project grouped by `ProjectLinkGroup` (HU-07): one collapsible card per group. Rows are edited
 * inline, reordered inside their group with the pointer, the keyboard or the arrow buttons, and each link
 * opens in a new tab or copies its URL. Pure controlled component: the caller owns the rows.
 */
export function ProjectLinksEditor({
  rows,
  onChange,
  editable = false,
  reorderable = false,
}: ProjectLinksEditorProps) {
  const t = useTranslations("projects.links");
  const tToast = useTranslations("projects.toast");
  const tGroup = useTranslations("enums.ProjectLinkGroup");
  const tRoot = useTranslations();
  const [announcement, setAnnouncement] = useState("");
  const [openOverride, setOpenOverride] = useState<Partial<Record<ProjectLinkGroup, boolean>>>({});
  const [iconFailed, setIconFailed] = useState<Record<string, boolean>>({});
  const interactive = onChange !== undefined && (editable || reorderable);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const groups = LINK_GROUPS.filter((group) => editable || groupRows(rows, group).length > 0);
  if (groups.length === 0) return <p className="text-sm text-muted-foreground">{t("empty")}</p>;

  function update(next: ProjectLinkRow[]) {
    onChange?.(next);
  }

  function patch(key: string, values: Partial<ProjectLinkRow>) {
    update(rows.map((row) => (row.key === key ? { ...row, ...values } : row)));
  }

  function move(key: string, delta: -1 | 1) {
    const next = moveLink(rows, key, delta);
    const row = rows.find((item) => item.key === key);
    update(next);
    if (!row) return;
    const position = groupRows(next, row.group).findIndex((item) => item.key === key) + 1;
    setAnnouncement(
      t("reorderMoved", {
        label: row.label || row.url,
        position,
        total: groupRows(next, row.group).length,
        group: tGroup(row.group),
      }),
    );
  }

  /** Screen-reader messages of a pointer or keyboard drag (dnd-kit announces through its live region). */
  function announcementsFor(group: ProjectLinkGroup): Announcements {
    const labelOf = (id: string | number) => {
      const row = rows.find((item) => item.key === String(id));
      return row ? row.label || row.url : "";
    };
    const positionOf = (id: string | number) =>
      groupRows(rows, group).findIndex((item) => item.key === String(id)) + 1;
    const total = groupRows(rows, group).length;
    const groupName = tGroup(group);
    return {
      onDragStart: ({ active }) =>
        t("reorderPicked", { label: labelOf(active.id), group: groupName }),
      onDragOver: ({ active, over }) =>
        over
          ? t("reorderMoved", {
              label: labelOf(active.id),
              position: positionOf(over.id),
              total,
              group: groupName,
            })
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t("reorderDropped", {
              label: labelOf(active.id),
              position: positionOf(over.id),
              total,
            })
          : t("reorderCancelled"),
      onDragCancel: () => t("reorderCancelled"),
    };
  }

  function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return;
    update(reorderWithinGroup(rows, String(event.active.id), String(event.over.id)));
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast.success(tToast("copied"));
    } catch {
      toast.error(tRoot("common.errors.INTERNAL"));
    }
  }

  return (
    <div className="flex flex-col">
      <p aria-live="polite" role="status" className="sr-only">
        {announcement}
      </p>
      {groups.map((group) => {
        const items = groupRows(rows, group);
        const isOpen = openOverride[group] ?? items.length > 0;
        const GroupIcon = GROUP_ICONS[group];
        const groupName = tGroup(group);
        return (
          <Collapsible
            key={group}
            open={isOpen}
            onOpenChange={(open) => setOpenOverride((current) => ({ ...current, [group]: open }))}
            // The groups split by a rule, not boxed: the editor always sits inside a card.
            className="border-t first-of-type:border-t-0"
          >
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-3 text-left text-sm font-medium">
              <span className="flex items-center gap-2">
                <GroupIcon className="size-4 text-muted-foreground" aria-hidden />
                {groupName}
                <span className="text-xs text-muted-foreground tabular-nums">{items.length}</span>
              </span>
              {isOpen ? (
                <ChevronUp className="size-4" aria-hidden />
              ) : (
                <ChevronDown className="size-4" aria-hidden />
              )}
            </CollapsibleTrigger>
            <CollapsibleContent className="flex flex-col gap-3 pb-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={onDragEnd}
                accessibility={{
                  announcements: announcementsFor(group),
                  screenReaderInstructions: { draggable: t("reorderInstructions") },
                }}
              >
                <SortableContext
                  items={items.map((row) => row.key)}
                  strategy={verticalListSortingStrategy}
                >
                  <ul className="flex flex-col divide-y">
                    {items.map((row, index) => (
                      <SortableLinkRow
                        key={row.key}
                        row={row}
                        index={index}
                        total={items.length}
                        editable={editable && interactive}
                        reorderable={reorderable && interactive}
                        fallbackIcon={GroupIcon}
                        iconFailed={Boolean(iconFailed[row.key])}
                        errors={editable ? rowErrors(row) : {}}
                        onIconError={() =>
                          setIconFailed((current) => ({ ...current, [row.key]: true }))
                        }
                        onPatch={(values) => patch(row.key, values)}
                        onMoveUp={() => move(row.key, -1)}
                        onMoveDown={() => move(row.key, 1)}
                        onRemove={() => update(removeLink(rows, row.key))}
                        onCopy={() => void copy(row.url)}
                        validUrl={isValidUrl}
                        tRoot={tRoot}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
              {items.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("groupEmpty")}</p>
              ) : null}
              {editable && interactive ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="self-start"
                  onClick={() => update(addLink(rows, group, nextKey()))}
                >
                  <Plus aria-hidden />
                  {t("addInGroup", { group: groupName })}
                </Button>
              ) : null}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}

interface SortableLinkRowProps {
  row: ProjectLinkRow;
  index: number;
  total: number;
  editable: boolean;
  reorderable: boolean;
  fallbackIcon: LucideIcon;
  iconFailed: boolean;
  errors: { label?: string; url?: string };
  onIconError: () => void;
  onPatch: (values: Partial<ProjectLinkRow>) => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  onCopy: () => void;
  validUrl: (url: string) => boolean;
  tRoot: ReturnType<typeof useTranslations>;
}

/** One link row: drag handle (keyboard and pointer), favicon, label, URL and the row actions. */
function SortableLinkRow({
  row,
  index,
  total,
  editable,
  reorderable,
  fallbackIcon: FallbackIcon,
  iconFailed,
  errors,
  onIconError,
  onPatch,
  onMoveUp,
  onMoveDown,
  onRemove,
  onCopy,
  validUrl,
  tRoot,
}: SortableLinkRowProps) {
  const t = useTranslations("projects.links");
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: row.key, disabled: !reorderable });
  const icon = faviconUrl(row.url);
  const label = row.label || row.url;
  const urlError =
    errors.url ?? (row.url && !validUrl(row.url) ? VALIDATION_MESSAGES.invalidFormat : undefined);
  const urlId = `link-${row.key}-url`;
  const labelId = `link-${row.key}-label`;
  // The field error is the schema's message key, or the URL check above (CA3).
  const urlErrorText = urlError ? tRoot(urlError as never) : undefined;

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        "flex flex-col gap-3 bg-card py-3",
        isDragging && "relative z-10 opacity-80 shadow-md",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        {reorderable ? (
          <Button
            ref={setActivatorNodeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("dragHandle", { label })}
            className="cursor-grab"
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden />
          </Button>
        ) : null}
        {icon && !iconFailed ? (
          // The site's own favicon; the group icon stands in when it does not load (HU-07, no third party).
          // eslint-disable-next-line @next/next/no-img-element -- favicon of an arbitrary host, not an optimisable asset
          <img
            src={icon}
            alt=""
            width={16}
            height={16}
            className="size-4 shrink-0"
            referrerPolicy="no-referrer"
            onError={onIconError}
          />
        ) : (
          <FallbackIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        )}
        {editable ? null : <span className="min-w-0 truncate text-sm font-medium">{label}</span>}
        <div className="ms-auto flex items-center gap-1">
          {reorderable ? (
            <>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === 0}
                aria-label={t("moveUp", { label })}
                onClick={onMoveUp}
              >
                <ChevronUp aria-hidden />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                disabled={index === total - 1}
                aria-label={t("moveDown", { label })}
                onClick={onMoveDown}
              >
                <ChevronDown aria-hidden />
              </Button>
            </>
          ) : null}
          {row.url && validUrl(row.url) ? (
            <Button variant="ghost" size="icon-sm" asChild>
              <a
                href={row.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("open", { label })}
              >
                <ExternalLink aria-hidden />
              </a>
            </Button>
          ) : null}
          {row.url ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("copy", { label })}
              onClick={onCopy}
            >
              <Copy aria-hidden />
            </Button>
          ) : null}
          {editable ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("removeNamed", { label })}
              onClick={onRemove}
            >
              <Trash2 aria-hidden />
            </Button>
          ) : null}
        </div>
      </div>
      {editable ? (
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Field data-invalid={errors.label ? true : undefined}>
            <FieldLabel htmlFor={labelId}>{t("label")}</FieldLabel>
            <Input
              id={labelId}
              maxLength={80}
              value={row.label}
              aria-invalid={errors.label ? true : undefined}
              aria-describedby={errors.label ? `${labelId}-error` : undefined}
              onChange={(event) => onPatch({ label: event.target.value })}
            />
            {errors.label ? (
              <FieldError id={`${labelId}-error`}>{tRoot(errors.label as never)}</FieldError>
            ) : null}
          </Field>
          <Field data-invalid={urlErrorText ? true : undefined}>
            <FieldLabel htmlFor={urlId}>{t("url")}</FieldLabel>
            <Input
              id={urlId}
              inputMode="url"
              autoComplete="off"
              placeholder={t("urlPlaceholder")}
              value={row.url}
              aria-invalid={urlErrorText ? true : undefined}
              aria-describedby={urlErrorText ? `${urlId}-error` : undefined}
              onChange={(event) => onPatch({ url: event.target.value })}
            />
            {urlErrorText ? <FieldError id={`${urlId}-error`}>{urlErrorText}</FieldError> : null}
          </Field>
        </div>
      ) : null}
    </li>
  );
}
