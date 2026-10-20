import { diffLines } from "diff";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

export type DiffLine = { kind: "same" | "removed" | "added"; text: string };

/**
 * Line diff of two markdown texts (PRD §8.9.3 "compararla con la vigente (diff de texto, solo en markdown)"), as one
 * entry per line in reading order. Line endings are normalized so a CRLF copy is not a change of every line.
 */
export function diffDocumentLines(before: string, after: string): DiffLine[] {
  // Every line ends in "\n", so a last line followed by new ones is not reported as changed.
  const normalize = (text: string) => {
    const unix = text.replace(/\r\n?/g, "\n");
    return unix.endsWith("\n") ? unix : `${unix}\n`;
  };
  return diffLines(normalize(before), normalize(after)).flatMap((part) => {
    const kind: DiffLine["kind"] = part.added ? "added" : part.removed ? "removed" : "same";
    return part.value
      .replace(/\n$/, "")
      .split("\n")
      .map((text) => ({ kind, text }));
  });
}

const LINE_CLASS: Record<DiffLine["kind"], string> = {
  same: "",
  removed: "bg-destructive/10",
  added: "bg-emerald-500/10",
};

const SIGN: Record<DiffLine["kind"], string> = { same: " ", removed: "−", added: "+" };

/**
 * The diff of a version (`before`) against the current one (`after`). Each changed line says "Eliminado" or
 * "Agregado" to assistive technology and shows a −/+ sign, so the change never rests on color alone.
 */
export function DocumentVersionDiff({ before, after }: { before: string; after: string }) {
  const t = useTranslations("documents.versions.page");
  const lines = diffDocumentLines(before, after);
  if (lines.every((line) => line.kind === "same")) {
    return <p className="text-sm text-muted-foreground">{t("identical")}</p>;
  }
  return (
    <ol
      aria-label={t("legend")}
      className="overflow-x-auto rounded-2xl border bg-card py-2 font-mono text-sm"
    >
      {lines.map((line, index) => (
        <li
          key={index}
          data-kind={line.kind}
          className={cn("flex gap-3 px-4 whitespace-pre-wrap", LINE_CLASS[line.kind])}
        >
          {line.kind === "same" ? null : <span className="sr-only">{t(line.kind)}</span>}
          <span aria-hidden className="w-3 shrink-0 text-muted-foreground select-none">
            {SIGN[line.kind]}
          </span>
          <span className="min-w-0 break-words">{line.text || " "}</span>
        </li>
      ))}
    </ol>
  );
}
