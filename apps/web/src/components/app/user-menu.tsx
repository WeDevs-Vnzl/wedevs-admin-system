"use client";

import { LogOut, RotateCcw } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/components/app/app-sidebar";
import { resetMockDataAction } from "@/features/session/actions";
import type { SessionUser } from "@/lib/auth/types";

// The user menu of the topbar. Sign-out goes through Clerk. MOCK part — until cleanup: "Reset mock data"
// calls the session action and goes away with the mock layer.
export function UserMenu({ user }: { user: SessionUser }) {
  const t = useTranslations("shell.userMenu");
  const tMock = useTranslations("mock");
  const tAuth = useTranslations("auth");
  const tCommon = useTranslations("common");
  const tRole = useTranslations("enums.UserRole");
  const router = useRouter();
  const { signOut } = useClerk();
  const [resetOpen, setResetOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function resetData() {
    startTransition(async () => {
      const result = await resetMockDataAction({});
      setResetOpen(false);
      if (!result.ok) {
        toast.error(tCommon("errors.INTERNAL"));
        return;
      }
      toast.success(tMock("reset.success"));
      router.refresh();
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="h-9 gap-2 px-1.5"
            aria-label={t("label")}
            disabled={isPending}
          >
            <Avatar className="size-7">
              {user.imageUrl ? <AvatarImage src={user.imageUrl} alt="" /> : null}
              <AvatarFallback className="text-xs">{initialsOf(user.name)}</AvatarFallback>
            </Avatar>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="flex flex-col gap-0.5">
            <span className="truncate text-sm font-semibold">{user.name}</span>
            <span className="truncate text-xs font-normal text-muted-foreground">{user.email}</span>
            <span className="text-xs font-normal text-muted-foreground">
              {t("role")}: {tRole(user.role)}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel className="flex items-center justify-between text-xs text-muted-foreground">
              {tMock("menu.title")}
              <Badge variant="outline" className="text-[10px]">
                {tMock("badge.label")}
              </Badge>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => setResetOpen(true)}>
              <RotateCcw aria-hidden />
              {tMock("reset.label")}
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/sign-in" })}>
            <LogOut aria-hidden />
            {tAuth("signOut")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tMock("reset.title")}</AlertDialogTitle>
            <AlertDialogDescription>{tMock("reset.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon("actions.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={(event) => {
                event.preventDefault();
                resetData();
              }}
            >
              {tMock("reset.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
