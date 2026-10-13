"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Controller,
  useForm,
  useWatch,
  type FieldValues,
  type Resolver,
  type ResolverOptions,
} from "react-hook-form";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/patterns/confirm-dialog";
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
import { DateField } from "@/components/ui/date-field";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useOpenerFocus } from "@/features/clients/components/use-opener-focus";
import { setProjectStatusAction } from "@/features/projects/actions";
import type { ProjectStatus } from "@/lib/validators/enums";
import {
  PROJECT_STATUS_TRANSITIONS,
  setProjectStatusInputSchema,
  type ProjectStatusHint,
} from "@/lib/validators/projects";

export interface ProjectStatusSubject {
  id: string;
  status: ProjectStatus;
  startDate: string | null;
  endDate: string | null;
}

interface TransitionValues {
  status: ProjectStatus;
  startDate: string;
  endDate: string;
}

const orUndefined = (value: string) => (value === "" ? undefined : value);

/** Hints are data from the service: each one is a non-blocking warning (PRD §8.3). */
function showHints(hints: readonly ProjectStatusHint[], tRoot: (key: string) => string) {
  for (const hint of hints) toast.warning(tRoot(`projects.hints.${hint}`));
}

interface ProjectTransitionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: ProjectStatusSubject;
  /** `CANCELADO` leaves this dialog for the confirmation (CA3): the caller opens `ProjectCancelDialog`. */
  onRequestCancel: () => void;
}

/**
 * Status change of a project (HU-08): targets from `PROJECT_STATUS_TRANSITIONS`, the start date for
 * `EN_CURSO` and the actual delivery date for `ENTREGADO`, validated by the action's schema. Cancelling is
 * a separate confirmation. Focus returns to the opener on close (W2 T1).
 */
export function ProjectTransitionDialog({
  open,
  onOpenChange,
  project,
  onRequestCancel,
}: ProjectTransitionDialogProps) {
  const t = useTranslations("projects");
  const tRoot = useTranslations();
  const tStatus = useTranslations("enums.ProjectStatus");
  const router = useRouter();
  const targets = PROJECT_STATUS_TRANSITIONS[project.status];
  useOpenerFocus(open);

  const validate = zodResolver(setProjectStatusInputSchema) as unknown as Resolver<FieldValues>;
  const form = useForm<TransitionValues>({
    defaultValues: {
      status: targets[0] ?? project.status,
      startDate: project.startDate ?? "",
      endDate: project.endDate ?? "",
    },
    // The action's schema, with the record id added: the form has no id field of its own.
    resolver: (values, context, options) =>
      validate(
        {
          id: project.id,
          status: values.status,
          startDate: orUndefined(values.startDate),
          endDate: orUndefined(values.endDate),
        },
        context,
        options as unknown as ResolverOptions<FieldValues>,
      ) as never,
  });
  const target = useWatch({
    control: form.control,
    name: "status",
    defaultValue: form.getValues("status"),
  });

  async function onValid(values: TransitionValues) {
    const result = await setProjectStatusAction({
      id: project.id,
      status: values.status,
      startDate: orUndefined(values.startDate),
      endDate: orUndefined(values.endDate),
    });
    if (!result.ok) {
      toast.error(tRoot(`common.errors.${result.error.code}` as never));
      return;
    }
    toast.success(t("toast.statusChanged"));
    showHints(result.data.hints, (key) => tRoot(key as never));
    onOpenChange(false);
    router.refresh();
  }

  function submit() {
    if (target === "CANCELADO") {
      onOpenChange(false);
      onRequestCancel();
      return;
    }
    void form.handleSubmit(onValid)();
  }

  const startError = form.formState.errors.startDate;
  const endError = form.formState.errors.endDate;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
          className="flex flex-col gap-5"
        >
          <DialogHeader>
            <DialogTitle>{t("transition.title")}</DialogTitle>
            <DialogDescription>
              {t("transition.description", { status: tStatus(project.status) })}
            </DialogDescription>
          </DialogHeader>

          {targets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("transition.noTargets")}</p>
          ) : (
            <>
              <Controller
                control={form.control}
                name="status"
                render={({ field }) => (
                  <Field>
                    <FieldLabel htmlFor="transition-target">{t("transition.target")}</FieldLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="transition-target" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {targets.map((status) => (
                          <SelectItem key={status} value={status}>
                            {tStatus(status)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                )}
              />

              {target === "EN_CURSO" ? (
                <Controller
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <Field data-invalid={startError ? true : undefined}>
                      <FieldLabel htmlFor="transition-start">
                        {t("transition.startDate")}
                      </FieldLabel>
                      <DateField
                        id="transition-start"
                        value={field.value}
                        onChange={field.onChange}
                        aria-invalid={startError ? true : undefined}
                      />
                      {startError ? (
                        <FieldError>{t("transition.startDateRequired")}</FieldError>
                      ) : null}
                    </Field>
                  )}
                />
              ) : null}

              {target === "ENTREGADO" ? (
                <Controller
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <Field data-invalid={endError ? true : undefined}>
                      <FieldLabel htmlFor="transition-end">{t("transition.endDate")}</FieldLabel>
                      <DateField
                        id="transition-end"
                        value={field.value}
                        onChange={field.onChange}
                        aria-invalid={endError ? true : undefined}
                      />
                      {endError ? <FieldError>{t("transition.endDateRequired")}</FieldError> : null}
                    </Field>
                  )}
                />
              ) : null}
            </>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t("transition.cancel")}
              </Button>
            </DialogClose>
            {targets.length > 0 ? (
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {t("transition.submit")}
              </Button>
            ) : null}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectCancelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
}

/**
 * `CANCELADO` through `ConfirmDialog` with its two options (CA3): cancel the pending installments, end the
 * recurring charges. Sends `confirm: true` as the service requires for this target.
 */
export function ProjectCancelDialog({ open, onOpenChange, projectId }: ProjectCancelDialogProps) {
  const t = useTranslations("projects");
  const tRoot = useTranslations();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  useOpenerFocus(open);

  async function confirm(result: { options?: Record<string, boolean> }) {
    setPending(true);
    const outcome = await setProjectStatusAction({
      id: projectId,
      status: "CANCELADO",
      confirm: true,
      cancelPendingInstallments: result.options?.cancelPendingInstallments ?? false,
      finishRecurringCharges: result.options?.finishRecurringCharges ?? false,
    });
    setPending(false);
    if (!outcome.ok) {
      toast.error(tRoot(`common.errors.${outcome.error.code}` as never));
      return;
    }
    toast.success(t("toast.statusChanged"));
    showHints(outcome.data.hints, (key) => tRoot(key as never));
    onOpenChange(false);
    router.refresh();
  }

  return (
    <ConfirmDialog
      variant="cancel"
      open={open}
      onOpenChange={onOpenChange}
      description={t("transition.cancelDescription")}
      options={[
        { id: "cancelPendingInstallments", label: t("transition.cancelOptionPending") },
        { id: "finishRecurringCharges", label: t("transition.cancelOptionRecurring") },
      ]}
      pending={pending}
      onConfirm={(result) => void confirm(result)}
    />
  );
}
