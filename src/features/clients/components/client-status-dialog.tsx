"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setClientStatusAction } from "@/features/clients/actions";
import { CLIENT_STATUS_VALUES, type ClientStatus } from "@/lib/validators/enums";
import { useOpenerFocus } from "./use-opener-focus";

type ClientStatusDialogProps = {
  clientId: string;
  current: ClientStatus;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
};

/** Manual status change of a client (PRD §8.2: the status is never derived). */
export function ClientStatusDialog(props: ClientStatusDialogProps) {
  useOpenerFocus(props.open);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {/* Mounted per opening, so each one starts from the record's current status. */}
      {props.open ? <StatusContent {...props} /> : null}
    </Dialog>
  );
}

function StatusContent({ clientId, current, onOpenChange, onChanged }: ClientStatusDialogProps) {
  const t = useTranslations("clients");
  const tEnums = useTranslations("enums");
  const tErrors = useTranslations("common.errors");
  const tActions = useTranslations("common.actions");
  const [status, setStatus] = useState<ClientStatus>(current);
  const [pending, setPending] = useState(false);

  async function submit() {
    setPending(true);
    const result = await setClientStatusAction({ id: clientId, status });
    setPending(false);
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    toast.success(t("toast.statusChanged"));
    onOpenChange(false);
    onChanged();
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("detail.statusDialog.title")}</DialogTitle>
        <DialogDescription>{t("detail.statusDialog.description")}</DialogDescription>
      </DialogHeader>
      <Field>
        <FieldLabel htmlFor="client-status-dialog">{t("detail.statusDialog.label")}</FieldLabel>
        <Select value={status} onValueChange={(next) => setStatus(next as ClientStatus)}>
          <SelectTrigger id="client-status-dialog">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLIENT_STATUS_VALUES.map((value) => (
              <SelectItem key={value} value={value}>
                {tEnums(`ClientStatus.${value}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>
          {tActions("cancel")}
        </Button>
        <Button onClick={() => void submit()} disabled={pending || status === current}>
          {t("detail.statusDialog.submit")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
