import { toast } from "sonner";

/** Copies `text` and confirms with a toast. Nothing is logged: the text may be a one-time access key. */
export async function copyToClipboard(text: string, messages: { ok: string; failed: string }) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(messages.ok);
  } catch {
    toast.error(messages.failed);
  }
}
