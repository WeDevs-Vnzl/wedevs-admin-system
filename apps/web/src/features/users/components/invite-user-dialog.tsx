"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { USER_ROLE_VALUES } from "@/lib/validators/enums";
import { inviteUserInputSchema } from "@/lib/validators/users";
import type { z } from "@/lib/validators/zod";
import { inviteUserAction } from "../actions";

type FormValues = z.input<typeof inviteUserInputSchema>;
type FormOutput = z.output<typeof inviteUserInputSchema>;

type InviteUserDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after the invitation was created so the table reloads its rows. */
  onInvited?: () => void;
};

/** "Invitar usuario" (PRD §8.15): e-mail and role; the invitation itself is sent by Clerk in Hito 2. */
export function InviteUserDialog({ open, onOpenChange, onInvited }: InviteUserDialogProps) {
  const t = useTranslations("settings.users");
  const tRoles = useTranslations("enums.UserRole");
  const tRoot = useTranslations();
  const form = useForm<FormValues, unknown, FormOutput>({
    resolver: zodResolver(inviteUserInputSchema),
    defaultValues: { email: "", role: "ADMIN" },
  });
  const message = (key: string | undefined) => (key ? tRoot(key as never) : undefined);

  async function onSubmit(values: FormOutput) {
    const result = await inviteUserAction(values);
    if (!result.ok) {
      const emailError = result.error.fieldErrors?.email?.[0];
      if (emailError) {
        form.setError("email", { message: emailError });
        return;
      }
      toast.error(tRoot(result.error.message as never));
      return;
    }
    toast.success(t("toast.invited", { email: result.data.email }));
    onOpenChange(false);
    onInvited?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={form.handleSubmit(onSubmit)} noValidate className="flex flex-col gap-6">
          <DialogHeader>
            <DialogTitle>{t("invite.title")}</DialogTitle>
            <DialogDescription>{t("invite.description")}</DialogDescription>
          </DialogHeader>

          <Field data-invalid={form.formState.errors.email ? true : undefined}>
            <FieldLabel htmlFor="invite-email">{t("invite.email")}</FieldLabel>
            <Input
              id="invite-email"
              type="email"
              autoComplete="off"
              maxLength={254}
              aria-invalid={form.formState.errors.email ? true : undefined}
              {...form.register("email")}
            />
            <FieldError>{message(form.formState.errors.email?.message)}</FieldError>
          </Field>

          <Controller
            control={form.control}
            name="role"
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="invite-role">{t("invite.role")}</FieldLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invite-role" className="w-full">
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
              </Field>
            )}
          />

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("invite.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? t("invite.sending") : t("invite.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
