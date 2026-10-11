"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArchiveIcon, PinIcon, PaperclipIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
import { DateText } from "@/components/patterns/date-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
  type FacetOption,
} from "@/components/ui/data-table";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";
import { useCsvExport } from "@/features/export/use-csv-export";
import {
  archiveNoteAction,
  exportNotesCsvAction,
  listNotesAction,
} from "@/features/notes/actions";
import { assignTagsAction, listTagsAction } from "@/features/tags/actions";
import { TagChips } from "@/features/tags/components/tag-chips";
import { TagPicker } from "@/features/tags/components/tag-picker";
import { entityHref } from "@/lib/entity-routes";
import type { ListQuery } from "@/lib/validators/common";
import {
  NOTE_LINK_ENTITY_TYPE_VALUES,
  type NoteListRowDTO,
} from "@/lib/validators/notes";
import type { TagChipDTO } from "@/lib/validators/tags";
import { noteRowTitle } from "../columns";
import { toNoteFilter } from "./note-table-query";

export interface NotesTableProps {
  /** First page, read on the server for the query in the URL. */
  initialRows: NoteListRowDTO[];
  initialTotal: number;
  /** The signed-in user's id: a Member archives the notes they wrote. */
  viewerId: string;
  /** `can(viewer, "delete", "note")`: Owner and Admin archive every note. */
  canArchiveAll: boolean;
  /** `can(viewer, "delete", "note", { ownerId: viewer.id })`: Member archives own notes only. */
  canArchiveOwn: boolean;
  /** `can(viewer, "update", "note")`: bulk tagging. */
  canTag: boolean;
  /** `can(viewer, "create", "note")`: inline creation of tags in the bulk picker. */
  canCreateTags: boolean;
}

const helper = createDataTableColumnHelper<NoteListRowDTO>();

/** Tags of an action result as a plain list of ids, for the bulk assignment. */
function idsOf(tags: readonly TagChipDTO[]): string[] {
  return tags.map((tag) => tag.id);
}

/**
 * Adds the picked tags to every selected note: one `assignTagsAction` per note (the service merges, so tags
 * already on a note stay). The picker stays empty; it only reports what was picked.
 */
function BulkTagPicker({
  noteIds,
  canCreateTags,
  onTagged,
}: {
  noteIds: string[];
  canCreateTags: boolean;
  onTagged: () => void;
}) {
  const t = useTranslations("notes.table");
  const [pending, setPending] = useState(false);

  async function tag(picked: TagChipDTO[]) {
    if (picked.length === 0) return;
    setPending(true);
    const tagIds = idsOf(picked);
    const results = await Promise.all(
      noteIds.map((entityId) => assignTagsAction({ entityType: "NOTE", entityId, tagIds })),
    );
    setPending(false);
    if (results.some((result) => !result.ok)) toast.error(t("bulkTagFailed"));
    else toast.success(t("bulkTagged", { count: noteIds.length }));
    onTagged();
  }

  return (
    <div className="w-72 max-w-full">
      <TagPicker
        value={[]}
        onChange={(picked) => void tag(picked)}
        canCreate={canCreateTags}
        disabled={pending}
        aria-label={t("bulkTag")}
      />
    </div>
  );
}

/**
 * The global notes table (`/notes`): title or derived title, excerpt, author, linked records through
 * `entityHref`, tags, attachment count, pinned, dates. Facets, search and sort are server-side: a query change
 * reloads the rows through `listNotesAction`, the first render uses the server rows (like the tags table).
 */
export function NotesTable({
  initialRows,
  initialTotal,
  viewerId,
  canArchiveAll,
  canArchiveOwn,
  canTag,
  canCreateTags,
}: NotesTableProps) {
  const t = useTranslations("notes");
  const tErrors = useTranslations("common.errors");
  const tEntity = useTranslations("enums.EntityType");
  const { query, setQuery } = useTableUrlState();
  const exportCsv = useCsvExport(exportNotesCsvAction, "NOTE");
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [archiving, setArchiving] = useState<NoteListRowDTO | null>(null);
  const [pending, setPending] = useState(false);
  useOpenerFocus(archiving !== null);

  // The first render already shows the server page for this URL; later query changes read through the action.
  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listNotesAction(toNoteFilter(next));
      setLoading(false);
      if (!result.ok) {
        toast.error(tErrors(result.error.code));
        return;
      }
      setRows(result.data.items);
      setTotal(result.data.total);
    },
    [tErrors],
  );

  useEffect(() => {
    if (queryKey === firstQueryKey.current) return;
    void load(query);
  }, [query, queryKey, load]);

  async function archive() {
    if (!archiving) return;
    setPending(true);
    const result = await archiveNoteAction({ id: archiving.id });
    setPending(false);
    setArchiving(null);
    if (!result.ok) {
      toast.error(t("toast.error"));
      return;
    }
    toast.success(t("toast.archived"));
    void load(query);
  }

  const columns = useMemo<DataTableColumnDef<NoteListRowDTO>[]>(() => {
    // Own-notes rule (PRD §4.3): Members archive the notes they wrote; the server checks it again (C13).
    const canArchive = (row: NoteListRowDTO) =>
      canArchiveAll || (canArchiveOwn && row.author.id === viewerId);
    return [
      helper.accessor("title", {
        header: t("columns.title"),
        cell: ({ row }) => (
          <Link
            href={`/notes/${encodeURIComponent(row.original.id)}`}
            className="font-medium hover:underline"
          >
            {noteRowTitle(row.original) || t("untitled")}
          </Link>
        ),
        meta: { label: t("columns.title"), sortable: true, pinned: true },
      }),
      helper.accessor("excerpt", {
        header: t("columns.excerpt"),
        cell: ({ getValue }) => (
          <span className="line-clamp-2 text-sm text-muted-foreground">{getValue()}</span>
        ),
        meta: { label: t("columns.excerpt") },
      }),
      helper.accessor((row) => row.author.name, {
        id: "author",
        header: t("columns.author"),
        meta: { label: t("columns.author") },
      }),
      helper.display({
        id: "links",
        header: t("columns.links"),
        cell: ({ row }) => (
          <ul className="flex flex-wrap gap-1.5">
            {row.original.links.map((link) => {
              const href = entityHref(link);
              const chip = (
                <Badge variant="secondary" className="font-normal">
                  {link.label}
                </Badge>
              );
              return (
                <li key={`${link.type}:${link.id}`}>
                  {href ? (
                    <Link href={href} className="inline-flex">
                      {chip}
                    </Link>
                  ) : (
                    <span className="inline-flex" title={tEntity(link.type)}>
                      {chip}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        ),
        meta: { label: t("columns.links") },
      }),
      helper.display({
        id: "tags",
        header: t("columns.tags"),
        cell: ({ row }) => <TagChips tags={row.original.tags} />,
        meta: { label: t("columns.tags") },
      }),
      helper.accessor("attachmentCount", {
        // The id is the export column id (NOTE_COLUMN_IDS): the CSV export reads `attachments`.
        id: "attachments",
        header: t("columns.attachments"),
        cell: ({ getValue }) =>
          getValue() > 0 ? (
            <span className="inline-flex items-center gap-1 text-sm">
              <PaperclipIcon aria-hidden className="size-3.5" />
              <span className="tabular-nums">{getValue()}</span>
            </span>
          ) : null,
        meta: { label: t("columns.attachments") },
      }),
      helper.accessor("pinned", {
        header: t("columns.pinned"),
        cell: ({ getValue }) =>
          getValue() ? (
            <Badge variant="secondary" className="gap-1">
              <PinIcon aria-hidden className="size-3" />
              {t("card.pinned")}
            </Badge>
          ) : null,
        meta: { label: t("columns.pinned"), sortable: true },
      }),
      helper.accessor("createdAt", {
        header: t("columns.createdAt"),
        cell: ({ getValue }) => <DateText value={new Date(getValue())} />,
        meta: { label: t("columns.createdAt"), sortable: true },
      }),
      helper.accessor("updatedAt", {
        header: t("columns.updatedAt"),
        cell: ({ getValue }) => <DateText value={new Date(getValue())} />,
        meta: { label: t("columns.updatedAt"), sortable: true },
      }),
      helper.display({
        id: "actions",
        header: "",
        cell: ({ row }) =>
          canArchive(row.original) ? (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("table.archive", { title: noteRowTitle(row.original) || t("untitled") })}
              onClick={() => setArchiving(row.original)}
            >
              <ArchiveIcon aria-hidden />
            </Button>
          ) : null,
        meta: { label: t("table.actions"), hideable: false, exportable: false },
      }),
    ];
  }, [t, tEntity, canArchiveAll, canArchiveOwn, viewerId]);

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "authorId",
        kind: "async",
        label: t("table.facets.author"),
        loadOptions: async (search: string): Promise<FacetOption[]> => {
          // No user listing service in H1-B2: the authors of the newest notes, filtered by the typed name.
          const result = await listNotesAction({ pageSize: 100 });
          if (!result.ok) {
            toast.error(tErrors(result.error.code));
            return [];
          }
          const needle = search.trim().toLowerCase();
          const authors = new Map<string, string>();
          for (const row of result.data.items) authors.set(row.author.id, row.author.name);
          return [...authors]
            .filter(([, name]) => name.toLowerCase().includes(needle))
            .map(([value, label]) => ({ value, label }));
        },
      },
      {
        id: "tagId",
        kind: "async",
        label: t("table.facets.tag"),
        loadOptions: async (search: string): Promise<FacetOption[]> => {
          const result = await listTagsAction({ q: search || undefined, pageSize: 50 });
          if (!result.ok) {
            toast.error(tErrors(result.error.code));
            return [];
          }
          return result.data.items.map((tag) => ({ value: tag.id, label: tag.name }));
        },
      },
      {
        id: "linkedEntityType",
        kind: "options",
        label: t("table.facets.linkedEntityType"),
        options: NOTE_LINK_ENTITY_TYPE_VALUES.map((value) => ({
          value,
          label: tEntity(value),
        })),
      },
      {
        id: "createdAt",
        kind: "dateRange",
        label: t("table.facets.createdAt"),
        fromKey: "createdFrom",
        toKey: "createdTo",
      },
    ],
    [t, tEntity, tErrors],
  );

  return (
    <div className="flex flex-col gap-3">
      <DataTable<NoteListRowDTO>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        facets={facets}
        searchPlaceholder={t("table.search")}
        selectable={canTag}
        bulkActions={
          canTag
            ? (ids) => (
                <BulkTagPicker
                  noteIds={ids}
                  canCreateTags={canCreateTags}
                  onTagged={() => void load(query)}
                />
              )
            : undefined
        }
        onExport={exportCsv}
        emptyState={{
          title: t("table.empty.title"),
          description: t("table.empty.description"),
        }}
      />

      <ConfirmDialog
        variant="archive"
        open={archiving !== null}
        onOpenChange={(open) => {
          if (!open) setArchiving(null);
        }}
        onConfirm={() => void archive()}
        pending={pending}
      />
    </div>
  );
}

