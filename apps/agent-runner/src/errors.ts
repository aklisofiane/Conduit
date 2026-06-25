/** Narrow an unknown thrown value to its message string. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
