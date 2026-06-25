/**
 * Normalize an unknown thrown value to a human-readable message. Replaces the
 * `err instanceof Error ? err.message : String(err)` pattern that otherwise
 * litters every catch block — one place to evolve (e.g. add cause/stack
 * capture) if the policy ever changes. Pure and sandbox-safe.
 */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
