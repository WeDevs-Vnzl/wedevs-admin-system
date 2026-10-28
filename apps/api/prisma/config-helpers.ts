/** Placeholder datasource URL used only by `prisma generate`, which never connects. */
export const GENERATE_ONLY_URL = 'postgresql://localhost:5433/generate_only';

/** True only when the Prisma CLI subcommand (first argument after the binary) is `generate`. */
export function isGenerateCommand(argv: readonly string[]): boolean {
  return argv[2] === 'generate';
}

/**
 * Returns the placeholder URL when `DIRECT_URL` is unset and the command is `generate`; otherwise
 * `undefined` so the caller resolves `DIRECT_URL` strictly (migrate commands fail without it).
 */
export function generateOnlyFallback(
  argv: readonly string[],
  directUrl: string | undefined,
): string | undefined {
  return directUrl === undefined && isGenerateCommand(argv) ? GENERATE_ONLY_URL : undefined;
}
