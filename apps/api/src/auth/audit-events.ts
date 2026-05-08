/**
 * Closed event taxonomy for `AuditLog`. Anything written to `AuditLog.event`
 * must come from this list — out-of-list strings are a type error at the
 * service boundary. Adding a new event = adding a new entry here, plus a hook
 * that emits it.
 *
 * Categories:
 *   - `auth.*` — sign-in / sign-up / sign-out / password reset
 *   - `org.*` — org create/delete/rename
 *   - `org.member.*` — member + invitation lifecycle
 *
 * Out of v1 (see operational-hardening spec): cross-org rejection events,
 * session expiry, admin-revoke (no Conduit-side flow yet), credential reads.
 */
export const AUDIT_EVENTS = [
  'auth.signIn',
  'auth.signIn.failed',
  'auth.signUp',
  'auth.signOut',
  'auth.passwordReset.requested',
  'auth.passwordReset.completed',
  'org.created',
  'org.deleted',
  'org.renamed',
  'org.member.invited',
  'org.member.invitationAccepted',
  'org.member.invitationRejected',
  'org.member.invitationRevoked',
  'org.member.removed',
  'org.member.roleChanged',
  'org.member.left',
] as const;

export type AuditEvent = (typeof AUDIT_EVENTS)[number];
