import type { DiagnosticsPort } from '../../../src/modules/identity/application/ports/diagnostics.port';

export class RecordingDiagnostics implements DiagnosticsPort {
  readonly warnings: { message: string; context: Readonly<Record<string, unknown>> }[] = [];

  warn(message: string, context: Readonly<Record<string, unknown>>): void {
    this.warnings.push({ message, context });
  }
}
