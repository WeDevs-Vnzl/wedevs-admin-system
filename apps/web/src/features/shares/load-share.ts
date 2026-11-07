import "server-only";
import { notFound } from "next/navigation";
import { z } from "@/lib/validators/zod";
import type { ShareLinkDetailDTO } from "@/lib/validators/shares";
// MOCK — until cleanup: CLEAN replaces `@/lib/service-error` and the readers that catch it.
import { ServiceError } from "@/lib/service-error";
import { getShareLink } from "./queries";

/**
 * Runs a share read for a page: what the BE refuses (`404`, `403`, `422`) and a malformed id render the in-shell
 * not-found page (C13: a role without `share` gets the same page as an unknown id); other errors propagate.
 */
export async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "NOT_FOUND" || error.code === "FORBIDDEN" || error.code === "VALIDATION")
    ) {
      notFound();
    }
    if (error instanceof z.ZodError) notFound();
    throw error;
  }
}

/** The link of the detail page. Unknown and malformed ids render the in-shell not-found page; other errors propagate. */
export function loadShareOr404(id: string): Promise<ShareLinkDetailDTO> {
  return orNotFound(getShareLink(id));
}
