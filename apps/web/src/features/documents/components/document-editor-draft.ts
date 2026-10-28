"use client";

import { useCallback, useRef, useState } from "react";
import { saveDocumentDraftAction } from "../actions";

/**
 * - `idle` — nothing typed since the editor opened;
 * - `dirty` — changes wait for "Save draft";
 * - `saving` — the draft is on its way;
 * - `saved` — the draft holds the latest text;
 * - `error` — the last save failed ("Save draft" retries).
 */
export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

interface DraftSaveOptions {
  documentId: string;
  /** Called when the server reports the document signed (INTEGRITY_LOCK). */
  onLocked: () => void;
}

/**
 * Explicit draft save of the markdown editor. The editor never saves on its own: `change(text)` only marks the text
 * unsaved, and `save(text)` sends it to `saveDocumentDraftAction`, which stores `draftContent`, logs the change and
 * creates no version. A response for text that changed meanwhile leaves the state `dirty`.
 */
export function useDraftSave({ documentId, onLocked }: DraftSaveOptions) {
  const [state, setState] = useState<SaveState>("idle");
  const latest = useRef<string | null>(null);

  const change = useCallback((content: string) => {
    latest.current = content;
    setState("dirty");
  }, []);

  const save = useCallback(
    async (content: string) => {
      latest.current = content;
      setState("saving");
      const result = await saveDocumentDraftAction({ documentId, content });
      if (latest.current !== content) return;
      if (result.ok) {
        setState("saved");
        return;
      }
      setState("error");
      if (result.error.code === "INTEGRITY_LOCK") onLocked();
    },
    [documentId, onLocked],
  );

  /** After publishing: the published text counts as saved. */
  const markSaved = useCallback((content: string) => {
    latest.current = content;
    setState("saved");
  }, []);

  return {
    state,
    change,
    save,
    markSaved,
    /** "Save draft" is offered while there is something to store and no save is running. */
    canSave: state === "dirty" || state === "error",
    /** Changes that are not stored yet (the leave guard). */
    pending: state === "dirty" || state === "saving" || state === "error",
  };
}
