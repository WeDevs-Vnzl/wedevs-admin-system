export const DIAGNOSTICS_TOKEN = Symbol('IDENTITY_DIAGNOSTICS');

/** Non-fatal conditions worth a log line (never secrets, C5). */
export interface DiagnosticsPort {
  warn(message: string, context: Readonly<Record<string, unknown>>): void;
}
