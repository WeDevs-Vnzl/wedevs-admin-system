"use client";

import { LogOut } from "lucide-react";
import { useClerk } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { initialsOf } from "@/components/app/app-sidebar";
import type { SessionUser } from "@/lib/auth/types";

// The user menu of the topbar. Sign-out goes through Clerk.
export function UserMenu({ user }: { user: SessionUser }) {
  const t = useTranslations("shell.userMenu");
  const tAuth = useTranslations("auth");
  const tRole = useTranslations("enums.UserRole");
  const { signOut } = useClerk();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="h-9 gap-2 px-1.5" aria-label={t("label")}>
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
        <DropdownMenuItem onSelect={() => void signOut({ redirectUrl: "/sign-in" })}>
          <LogOut aria-hidden />
          {tAuth("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
