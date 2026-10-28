"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MailPlusIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { DateText } from "@/components/patterns/date-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DataTable,
  createDataTableColumnHelper,
  useTableUrlState,
  type DataTableColumnDef,
  type FacetConfig,
} from "@/components/ui/data-table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListQuery } from "@/lib/validators/common";
import { USER_ROLE_VALUES, type UserRole } from "@/lib/validators/enums";
import { USER_STATUS_VALUES, type UserListRowDTO } from "@/lib/validators/users";
import { changeUserRoleAction, listUsersAction, revokeUserInvitationAction } from "../actions";
import { InviteUserDialog } from "./invite-user-dialog";
import { userFilterOf } from "./users-table-query";

type UsersTableProps = {
  /** First page, read on the server for the query in the URL. */
  initialRows: UserListRowDTO[];
  initialTotal: number;
};

type DialogState = { open: boolean; key: number };

const helper = createDataTableColumnHelper<UserListRowDTO>();

/**
 * Settings → Usuarios (PRD §8.15 "Lista, rol e invitación"): users and pending invitations, the role of each
 * active user (editable in place), invitations by e-mail and their revocation. Owner only.
 */
export function UsersTable({ initialRows, initialTotal }: UsersTableProps) {
  const t = useTranslations("settings.users");
  const tRoles = useTranslations("enums.UserRole");
  const tRoot = useTranslations();
  const tErrors = useTranslations("common.errors");
  const { query, setQuery } = useTableUrlState();
  const [rows, setRows] = useState(initialRows);
  const [total, setTotal] = useState(initialTotal);
  const [loading, setLoading] = useState(false);
  const [dialog, setDialog] = useState<DialogState>({ open: false, key: 0 });

  const queryKey = JSON.stringify(query);
  const firstQueryKey = useRef(queryKey);
  const load = useCallback(
    async (next: ListQuery) => {
      setLoading(true);
      const result = await listUsersAction(userFilterOf(next));
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

  const changeRole = useCallback(
    async (row: UserListRowDTO, role: UserRole) => {
      if (role === row.role) return;
      const result = await changeUserRoleAction({ userId: row.id, role });
      if (!result.ok) {
        toast.error(tRoot(result.error.message as never));
        return;
      }
      setRows((current) => current.map((item) => (item.id === row.id ? { ...item, role } : item)));
      toast.success(t("toast.roleChanged", { name: row.name ?? row.email }));
    },
    [t, tRoot],
  );

  const revoke = useCallback(
    async (row: UserListRowDTO) => {
      const result = await revokeUserInvitationAction({ invitationId: row.id });
      if (!result.ok) {
        toast.error(tRoot(result.error.message as never));
        return;
      }
      toast.success(t("toast.revoked"));
      void load(query);
    },
    [t, tRoot, load, query],
  );

  const columns = useMemo<DataTableColumnDef<UserListRowDTO>[]>(
    () =>
      [
        helper.accessor((row) => row.name ?? row.email, {
          id: "name",
          header: t("columns.name"),
          size: 220,
          meta: { label: t("columns.name"), sortable: true, pinned: true },
          cell: ({ row }) => (
            <span className="font-medium">{row.original.name ?? row.original.email}</span>
          ),
        }),
        helper.accessor("email", {
          header: t("columns.email"),
          size: 240,
          meta: { label: t("columns.email"), sortable: true },
        }),
        helper.accessor("role", {
          header: t("columns.role"),
          size: 170,
          meta: { label: t("columns.role"), sortable: true },
          cell: ({ row }) =>
            row.original.status === "ACTIVE" ? (
              <Select
                value={row.original.role}
                onValueChange={(value) => void changeRole(row.original, value as UserRole)}
              >
                <SelectTrigger
                  size="sm"
                  aria-label={t("roleOf", { name: row.original.name ?? row.original.email })}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLE_VALUES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {tRoles(role)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              tRoles(row.original.role)
            ),
        }),
        helper.accessor("status", {
          header: t("columns.status"),
          size: 120,
          meta: { label: t("columns.status"), sortable: false },
          cell: ({ row }) => (
            <Badge variant={row.original.status === "ACTIVE" ? "secondary" : "outline"}>
              {t(`status.${row.original.status}`)}
            </Badge>
          ),
        }),
        helper.accessor("createdAt", {
          header: t("columns.createdAt"),
          size: 130,
          meta: { label: t("columns.createdAt"), sortable: true },
          cell: ({ row }) => <DateText value={new Date(row.original.createdAt)} style="short" />,
        }),
        helper.display({
          id: "actions",
          size: 80,
          meta: { label: t("columns.actions"), hideable: false, exportable: false },
          cell: ({ row }) =>
            row.original.status === "INVITED" ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("revoke", { email: row.original.email })}
                onClick={() => void revoke(row.original)}
              >
                <XIcon aria-hidden />
              </Button>
            ) : null,
        }),
      ] as DataTableColumnDef<UserListRowDTO>[],
    [t, tRoles, changeRole, revoke],
  );

  const facets = useMemo<FacetConfig[]>(
    () => [
      {
        id: "role",
        label: t("facets.role"),
        kind: "options",
        options: USER_ROLE_VALUES.map((value) => ({ value, label: tRoles(value) })),
      },
      {
        id: "status",
        label: t("facets.status"),
        kind: "options",
        options: USER_STATUS_VALUES.map((value) => ({ value, label: t(`status.${value}`) })),
      },
    ],
    [t, tRoles],
  );

  const openInvite = () => setDialog((current) => ({ open: true, key: current.key + 1 }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button onClick={openInvite}>
          <MailPlusIcon aria-hidden />
          {t("invite.open")}
        </Button>
      </div>

      <DataTable<UserListRowDTO>
        data={rows}
        columns={columns}
        getRowId={(row) => row.id}
        total={total}
        query={query}
        onQueryChange={setQuery}
        loading={loading}
        facets={facets}
        searchPlaceholder={t("search.placeholder")}
        selectable={false}
        emptyState={{ title: t("empty.title"), description: t("empty.description") }}
      />

      <InviteUserDialog
        key={dialog.key}
        open={dialog.open}
        onOpenChange={(open) => setDialog((current) => ({ ...current, open }))}
        onInvited={() => void load(query)}
      />
    </div>
  );
}
