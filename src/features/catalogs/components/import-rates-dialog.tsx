"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { MAX_RATE_CSV_ROWS, type ImportRatesCsvResult } from "@/lib/validators/catalogs";
import { importRatesCsvAction } from "../actions";
import { mergeImportErrors, parseRatesCsv, type ParsedRatesCsv } from "../rates-csv";

type ImportRatesDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: () => void;
};

type RowError = ImportRatesCsvResult["errors"][number];

function ImportRatesForm({ onOpenChange, onImported }: ImportRatesDialogProps) {
  const t = useTranslations("catalogs.rates.import");
  const tRates = useTranslations("catalogs.rates");
  const tActions = useTranslations("common.actions");
  const tErrors = useTranslations("common.errors");
  const tRoot = useTranslations();
  const [parsed, setParsed] = useState<ParsedRatesCsv | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [summary, setSummary] = useState<ImportRatesCsvResult | null>(null);
  const [errors, setErrors] = useState<RowError[]>([]);

  async function onFile(file: File | undefined) {
    setSummary(null);
    if (!file) {
      setParsed(null);
      setErrors([]);
      return;
    }
    const result = parseRatesCsv(await file.text());
    setParsed(result);
    setErrors(result.status === "ok" ? result.errors : []);
  }

  const fileProblem = (() => {
    if (!parsed) return null;
    if (parsed.status === "empty") return t("empty");
    if (parsed.status === "invalidHeader") return t("invalidHeader");
    if (parsed.status === "tooManyRows") return t("tooManyRows", { max: MAX_RATE_CSV_ROWS });
    if (parsed.status === "ok" && parsed.rows.length === 0) return t("noValidRows");
    return null;
  })();
  const ready = parsed?.status === "ok" && parsed.rows.length > 0 ? parsed : null;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!ready) return;
    setSubmitting(true);
    const result = await importRatesCsvAction({ rows: ready.rows, overwrite });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(tErrors(result.error.code));
      return;
    }
    setSummary(result.data);
    setErrors(mergeImportErrors(ready.errors, ready.lines, result.data.errors));
    toast.success(tRates("toast.imported"));
    onImported();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <Field data-invalid={fileProblem ? true : undefined}>
        <FieldLabel htmlFor="rates-csv-file">{t("file")}</FieldLabel>
        <Input
          id="rates-csv-file"
          type="file"
          accept=".csv,text/csv"
          aria-invalid={fileProblem ? true : undefined}
          onChange={(event) => void onFile(event.target.files?.[0])}
        />
        {fileProblem ? <FieldError>{fileProblem}</FieldError> : null}
        {ready && !summary ? (
          <FieldDescription>{t("ready", { count: ready.rows.length })}</FieldDescription>
        ) : null}
      </Field>

      <Field orientation="horizontal">
        <Checkbox
          id="rates-csv-overwrite"
          checked={overwrite}
          onCheckedChange={(checked) => setOverwrite(checked === true)}
        />
        <div className="grid gap-1">
          <FieldLabel htmlFor="rates-csv-overwrite">{t("overwrite")}</FieldLabel>
          <FieldDescription>{t("overwriteHint")}</FieldDescription>
        </div>
      </Field>

      {summary ? (
        <p role="status" className="text-sm font-medium">
          {t("summary", {
            created: summary.created,
            updated: summary.updated,
            skipped: summary.skipped,
          })}
        </p>
      ) : null}

      {errors.length > 0 ? (
        <div className="grid gap-1">
          <p className="text-sm font-medium">{t("errorsTitle")}</p>
          <ul className="max-h-40 overflow-y-auto overscroll-contain text-sm text-destructive">
            {errors.map((error) => (
              <li key={error.row}>
                {t("errorRow", {
                  row: error.row,
                  message: error.messages.map((key) => tRoot(key as never)).join(" · "),
                })}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={() => onOpenChange(false)}
          disabled={submitting}
        >
          {summary ? tActions("close") : tActions("cancel")}
        </Button>
        {summary ? null : (
          <Button type="submit" disabled={submitting || !ready}>
            {t("submit")}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}

// CSV import of rates (PRD §8.15): the file is parsed in the browser (`rates-csv.ts`), only the valid rows go to
// the action, and the dialog stays open on the summary with every rejected row.
export function ImportRatesDialog(props: ImportRatesDialogProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>{props.open ? <ImportRatesForm {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
