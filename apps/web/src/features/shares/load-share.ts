import "server-only";
import { notFound } from "next/navigation";
import { z } from "@/lib/validators/zod";
import type { ShareLinkDetailDTO } from "@/lib/validators/shares";
import { ServiceError } from "@/server/errors";
import { getShareLink } from "./queries";

/** The link of the detail page. Unknown and malformed ids render the in-shell not-found page; other errors propagate. */
export async function loadShareOr404(id: string): Promise<ShareLinkDetailDTO> {
  try {
    return await getShareLink(id);
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "NOT_FOUND" || error.code === "VALIDATION")
    ) {
      notFound();
    }
    if (error instanceof z.ZodError) notFound();
    throw error;
  }
}
