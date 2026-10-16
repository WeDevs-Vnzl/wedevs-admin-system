"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Uploader } from "@/components/ui/uploader";
import { uploadAdapter } from "@/features/files/upload-adapter";
import { uploadVersionInputSchema } from "@/lib/validators/documents";
import type { FileDTO } from "@/lib/validators/files";
import { uploadNewDocumentVersionAction } from "../actions";

type FieldName = "fileId" | "url" | "changelog";
type Errors = Partial<Record<FieldName, string>>;

export interface DocumentVersionUploadDialogProps {
  documentId: string;
  /** `ARCHIVO`: "Subir nueva versión"; `ENLACE`: "Actualizar enlace". */
  format: "ARCHIVO" | "ENLACE";
  /** A `FIRMADO` document accepts no new version: the trigger is disabled and says why. */
  signed: boolean;
}

/**
 * "Subir nueva versión" / "Actualizar enlace" (PRD §8.9.3): a `READY` file or an `http(s)` URL becomes version N+1,
 * with optional change notes. Checked here with the same schema the action parses; the server's field errors land
 * on the fields.
 */
export function DocumentVersionUploadDialog({
  documentId,
  format,
  signed,
}: DocumentVersionUploadDialogProps) {
  const t = useTranslations();
  const router = useRouter();
  const baseId = useId();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [file, setFile] = useState<FileDTO | null>(null);
  const [url, setUrl] = useState("");
  const [changelog, setChangelog] = useState("");
  const [errors, setErrors] = useState<Errors>({});

  const mode = format === "ARCHIVO" ? "file" : "link";
  const lockId = `${baseId}-lock`;
  const ids = {
    file: `${baseId}-file`,
    url: `${baseId}-url`,
    changelog: `${baseId}-changelog`,
  };
  const message = (name: FieldName) => {
    const key = errors[name];
    return key ? (t.has(key) ? t(key) : key) : undefined;
  };

  function onOpenChange(next: boolean) {
    if (pending) return;
    setOpen(next);
    if (next) {
      setFile(null);
      setUrl("");
      setChangelog("");
      setErrors({});
    }
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (format === "ARCHIVO" && !file) {
      setErrors({ fileId: "documents.versions.upload.fileRequired" });
      return;
    }
    const input =
      format === "ARCHIVO"
        ? { format, documentId, fileId: file?.id ?? "", changelog }
        : { format, documentId, url, changelog };
    const parsed = uploadVersionInputSchema.safeParse(input);
    if (!parsed.success) {
      const next: Errors = {};
      for (const issue of parsed.error.issues) {
        const name = issue.path[0] as FieldName;
        next[name] ??= issue.message;
      }
      setErrors(next);
      return;
    }
    startTransition(async () => {
      const result = await uploadNewDocumentVersionAction(parsed.data);
      if (!result.ok) {
        const next: Errors = {};
        for (const name of ["fileId", "url", "changelog"] as const) {
          const first = result.error.fieldErrors?.[name]?.[0];
          if (first) next[name] = first;
        }
        setErrors(next);
        if (Object.keys(next).length === 0) {
          toast.error(
            t.has(result.error.message)
              ? t(result.error.message)
              : t("documents.versions.upload.failed"),
          );
        }
        return;
      }
      toast.success(t("documents.versions.upload.done"));
      setOpen(false);
      router.refresh();
    });
  }

  const Icon = mode === "file" ? Upload : Link2;
  const urlError = message("url");
  const fileError = message("fileId");
  const changelogError = message("changelog");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col items-start gap-1">
        <DialogTrigger asChild>
          <Button
            variant="outline"
            disabled={signed}
            aria-describedby={signed ? lockId : undefined}
          >
            <Icon aria-hidden />
            {t(`documents.versions.upload.${mode}`)}
          </Button>
        </DialogTrigger>
        {signed ? (
          <p id={lockId} className="text-xs text-muted-foreground">
            {t("documents.versions.locked")}
          </p>
        ) : null}
      </div>
      <DialogContent>
        <form noValidate onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t(`documents.versions.upload.${mode}Title`)}</DialogTitle>
            <DialogDescription>
              {t(`documents.versions.upload.${mode}Description`)}
            </DialogDescription>
          </DialogHeader>

          {format === "ARCHIVO" ? (
            <Field data-invalid={fileError ? true : undefined}>
              <FieldLabel htmlFor={ids.file}>{t("documents.versions.upload.fileField")}</FieldLabel>
              <Uploader
                id={ids.file}
                adapter={uploadAdapter}
                context="general"
                multiple={false}
                disabled={pending}
                aria-label={t("documents.versions.upload.fileField")}
                onChange={(files) => {
                  setFile(files[0] ?? null);
                  setErrors((current) => ({ ...current, fileId: undefined }));
                }}
              />
              {fileError ? (
                <FieldError id={`${ids.file}-error`} errors={[{ message: fileError }]} />
              ) : null}
            </Field>
          ) : (
            <Field data-invalid={urlError ? true : undefined}>
              <FieldLabel htmlFor={ids.url}>{t("documents.versions.upload.urlField")}</FieldLabel>
              <Input
                id={ids.url}
                type="url"
                inputMode="url"
                autoComplete="url"
                value={url}
                placeholder={t("documents.versions.upload.urlPlaceholder")}
                onChange={(event) => setUrl(event.target.value)}
                aria-invalid={urlError ? true : undefined}
                aria-describedby={urlError ? `${ids.url}-error` : undefined}
              />
              {urlError ? (
                <FieldError id={`${ids.url}-error`} errors={[{ message: urlError }]} />
              ) : null}
            </Field>
          )}

          <Field data-invalid={changelogError ? true : undefined}>
            <FieldLabel htmlFor={ids.changelog}>
              {t("documents.versions.upload.changelog")}
            </FieldLabel>
            <Textarea
              id={ids.changelog}
              value={changelog}
              maxLength={500}
              placeholder={t("documents.versions.upload.changelogPlaceholder")}
              onChange={(event) => setChangelog(event.target.value)}
              aria-invalid={changelogError ? true : undefined}
              aria-describedby={changelogError ? `${ids.changelog}-error` : undefined}
            />
            {changelogError ? (
              <FieldError id={`${ids.changelog}-error`} errors={[{ message: changelogError }]} />
            ) : null}
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t("documents.versions.upload.cancel")}
            </Button>
            <Button type="submit" disabled={pending} aria-disabled={pending || undefined}>
              {t("documents.versions.upload.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
