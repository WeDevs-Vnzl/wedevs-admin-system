"use client";

import { EyeIcon, EyeOffIcon, LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import {
  ACCESS_KEY_LOCKOUT_MINUTES,
  ACCESS_KEY_MAX_LENGTH,
  ACCESS_KEY_MIN_LENGTH,
  type PortalDocumentDTO,
} from "@/lib/validators/shares";
import { unlockSharedDocumentAction } from "../actions";

type UnlockState = "idle" | "invalid" | "tooShort" | "locked" | "error";

export interface UnlockDialogProps {
  token: string;
  /** The document to unlock; `null` keeps the dialog closed. */
  document: PortalDocumentDTO | null;
  onClose: () => void;
  onUnlocked: (documentId: string) => void;
}

/**
 * Unlock dialog of a key-protected portal document (DT-45, frontend-patterns §11): a masked key input, a wrong-key
 * error and the lockout state after too many failures. The key travels only in the Server Action body, never in a
 * URL, and the dialog forgets it when it closes.
 */
export function UnlockDialog({ token, document, onClose, onUnlocked }: UnlockDialogProps) {
  return (
    <Dialog open={document !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        {document ? (
          // Keyed by document so a new dialog never shows the previous key or error.
          <UnlockForm
            key={document.documentId}
            token={token}
            document={document}
            onUnlocked={onUnlocked}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function UnlockForm({
  token,
  document,
  onUnlocked,
  onClose,
}: {
  token: string;
  document: PortalDocumentDTO;
  onUnlocked: (documentId: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations("portal.unlock");
  const inputId = useId();
  const errorId = useId();
  const [key, setKey] = useState("");
  const [visible, setVisible] = useState(false);
  const [state, setState] = useState<UnlockState>("idle");
  const [pending, startTransition] = useTransition();
  const locked = state === "locked";

  const message =
    state === "invalid"
      ? t("invalid")
      : state === "tooShort"
        ? t("tooShort", { min: ACCESS_KEY_MIN_LENGTH })
        : state === "locked"
          ? t("locked", { minutes: ACCESS_KEY_LOCKOUT_MINUTES })
          : state === "error"
            ? t("error")
            : null;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = key.trim();
    if (trimmed.length < ACCESS_KEY_MIN_LENGTH) {
      setState("tooShort");
      return;
    }
    startTransition(async () => {
      const result = await unlockSharedDocumentAction({
        token,
        documentId: document.documentId,
        key: trimmed,
      });
      if (result.ok) {
        setKey("");
        onUnlocked(document.documentId);
        return;
      }
      const code = result.error.code;
      setState(
        code === "ACCESS_KEY_LOCKED"
          ? "locked"
          : code === "ACCESS_KEY_INVALID"
            ? "invalid"
            : code === "VALIDATION"
              ? "tooShort"
              : "error",
      );
    });
  }

  return (
    <form onSubmit={submit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { title: document.title })}</DialogDescription>
      </DialogHeader>
      <Field data-invalid={message ? true : undefined} data-disabled={locked ? true : undefined}>
        <FieldLabel htmlFor={inputId}>{t("keyLabel")}</FieldLabel>
        <InputGroup>
          <InputGroupAddon>
            <LockIcon aria-hidden />
          </InputGroupAddon>
          <InputGroupInput
            id={inputId}
            type={visible ? "text" : "password"}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={ACCESS_KEY_MAX_LENGTH}
            value={key}
            onChange={(event) => {
              setKey(event.target.value);
              if (state !== "locked") setState("idle");
            }}
            disabled={locked}
            aria-invalid={message ? true : undefined}
            aria-describedby={message ? errorId : undefined}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={visible ? t("hideKey") : t("showKey")}
              aria-pressed={visible}
              onClick={() => setVisible((value) => !value)}
              disabled={locked}
            >
              {visible ? <EyeOffIcon aria-hidden /> : <EyeIcon aria-hidden />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {message ? (
          <FieldError id={errorId}>
            {locked ? <span className="block font-medium">{t("lockedTitle")}</span> : null}
            {message}
          </FieldError>
        ) : null}
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={locked || pending}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
