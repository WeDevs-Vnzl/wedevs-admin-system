import { notFound } from "next/navigation";
import { ServiceError } from "@/lib/service-error";

/**
 * Payments are for the finance roles (PRD §4.3): a role the BE refuses (`FORBIDDEN`) and an unknown id
 * (`NOT_FOUND`) both get the in-shell not-found page (C13). Any other failure reaches the error boundary.
 */
export async function notFoundWhenRefused<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
    ) {
      notFound();
    }
    throw error;
  }
}

/** `null` for an unknown id, so metadata can fall back to the generic title; other failures are rethrown. */
export async function orNullWhenMissing<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ServiceError && error.code === "NOT_FOUND") return null;
    throw error;
  }
}

/** Metadata never fails the page: a missing or refused record falls back to the generic title (the page decides). */
export async function orNullWhenUnavailable<T>(read: () => Promise<T>): Promise<T | null> {
  try {
    return await read();
  } catch (error) {
    if (
      error instanceof ServiceError &&
      (error.code === "FORBIDDEN" || error.code === "NOT_FOUND")
    ) {
      return null;
    }
    throw error;
  }
}
