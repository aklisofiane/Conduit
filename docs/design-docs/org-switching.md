# Organization switching and management

The browser-side surface that lets a signed-in user switch between every org they belong to, manage members of the active org, and accept incoming invitations — entirely on top of Better Auth's `organization` plugin endpoints. There is no Conduit-side API for any of it; the work is web pages + TanStack Query plumbing only. Pairs with the partitioning shim ([tenant-partitioning.md](./tenant-partitioning.md)) that auto-creates a personal org at signup and stamps `session.activeOrganizationId`, and with the auth shell ([web-auth-ui.md](./web-auth-ui.md)) whose `UserMenuPill` this sub-feature extends.

## Surface

| File | Role |
|---|---|
| `apps/web/src/api/organization.ts` | TanStack Query hooks (`useOrganizations`, `useActiveOrganization`, `useOrganizationMembers`, `useOrganizationInvitations`, `useUserInvitations`) and mutations (`useSetActiveOrganization`, `useCreateOrganization`, `useUpdateOrganization`, `useDeleteOrganization`, `useInviteMember`, `useCancelInvitation`, `useRemoveMember`, `useUpdateMemberRole`, `useLeaveOrganization`, `useAcceptInvitation`, `useRejectInvitation`, `useInvitation`). Wraps `authClient.organization.*`, centralizes the cache-key shape, and exposes `invalidateOrgScopedQueries(qc)` + `buildInviteUrl(invitationId)` for the switcher and the invite-URL fallback. |
| `apps/web/src/components/layout/UserMenuPill.tsx` | Extended popover. Pill *label* unchanged from `web-auth-ui` (status dot + name/email). Popover gains an Organizations section above Account-settings + Sign-out: active-org line, switch sub-list with optional filter, inline create-organization form, organization-settings link, pending-invitations link with numeric badge. Owns the switch flow. |
| `apps/web/src/pages/OrganizationSettingsPage.tsx` | `/account/organization`. Header (rename), members, pending invitations (per-row Copy invite URL + Revoke), invite form, danger zone (Leave / Delete with typed-name confirmation). |
| `apps/web/src/pages/InvitationsPage.tsx` | `/account/invitations`. Lists incoming pending invitations with accept/reject actions. |
| `apps/web/src/pages/AcceptInvitationPage.tsx` | `/accept-invitation/:invitationId`. Deep-link target shared via the copyable invite URL fallback; lives inside `RequireAuth` so unauthed visitors round-trip through `/sign-in?next=…`. |
| `apps/web/src/pages/AccountSettingsPage.tsx` (extended) | Adds Organization + Pending-invitations link cards mirroring the popover entries, so users navigating via the page see the same surface area. |

## Routing

```
RequireAuth → AppLayout (TopChrome + <Outlet />)
  /account                       AccountSettingsPage    (existing, extended)
  /account/organization          OrganizationSettingsPage  (new)
  /account/invitations           InvitationsPage           (new)
  /accept-invitation/:id         AcceptInvitationPage      (new)
```

All four routes live inside `AppLayout` + `RequireAuth`. The accept-invitation deep link relies on `RequireAuth` to redirect unauthed visitors to `/sign-in?next=/accept-invitation/<id>` and land them back on the page after sign-in.

## Better Auth `organization` plugin client

The `authClient.organization.*` namespace is auto-mounted because `apps/web/src/lib/auth-client.ts` registers `organizationClient()` from `better-auth/client/plugins` — required for the namespace to be typed and present at runtime. Method names in the client are camelCase derivations of the route paths. Verified surface (Better Auth 1.6.9):

| Method | Route | Body / Query |
|---|---|---|
| `organization.list` | `GET /organization/list` | — |
| `organization.getFullOrganization` | `GET /organization/get-full-organization` | optional `query.organizationId` |
| `organization.create` | `POST /organization/create` | `{ name, slug }` (slug required by the plugin; we slugify the name client-side) |
| `organization.update` | `POST /organization/update` | `{ organizationId, data: { name?, slug?, logo?, metadata? } }` |
| `organization.delete` | `POST /organization/delete` | `{ organizationId }` |
| `organization.setActive` | `POST /organization/set-active` | `{ organizationId? \| organizationSlug? }` |
| `organization.listMembers` | `GET /organization/list-members` | — |
| `organization.removeMember` | `POST /organization/remove-member` | `{ memberIdOrEmail }` |
| `organization.updateMemberRole` | `POST /organization/update-member-role` | `{ memberId, role }` |
| `organization.leave` | `POST /organization/leave` | `{ organizationId }` |
| `organization.inviteMember` | `POST /organization/invite-member` | `{ email, role }` |
| `organization.cancelInvitation` | `POST /organization/cancel-invitation` | `{ invitationId }` |
| `organization.listInvitations` | `GET /organization/list-invitations` | optional `query.organizationId` |
| `organization.listUserInvitations` | `GET /organization/list-user-invitations` | — |
| `organization.getInvitation` | `GET /organization/get-invitation` | `{ query: { id } }` |
| `organization.acceptInvitation` | `POST /organization/accept-invitation` | `{ invitationId }` |
| `organization.rejectInvitation` | `POST /organization/reject-invitation` | `{ invitationId }` |

Every method returns `{ data, error }`. Errors are surfaced via the form's RHF `setError('root', …)` for inline alerts (consistent with `web-auth-ui`'s helper convention) or via local component state for non-form actions.

## Cache invalidation on org switch

`useSetActiveOrganization`'s `onSuccess` calls `invalidateOrgScopedQueries(qc)`, which invalidates every top-level cache key that becomes stale the moment the active org changes:

```
['workflows'], ['workflow'], ['run'], ['credentials'], ['connections'],
['templates'], ['triggers'], ['agent-presets'], ['skills'],
['project-boards'], ['labels'],
['organizations'], ['organization', 'active'], ['organization', 'members'],
['organization', 'invitations']
```

After invalidation the switch flow navigates to `/`. Reasoning: every URL the user is currently on may now reference rows in the previous org and would 404 (per `authorization-enforcement`'s cross-org → 404 convention). A clean home page beats a chain of stale screens. Add new top-level cache keys to `ORG_SCOPED_QUERY_KEYS` in `organization.ts` whenever a new org-scoped resource lands.

## Invite-URL fallback

Email transport is a cross-cutting TODO (see [authentication.md § Cross-cutting status](./authentication.md#cross-cutting-status)); the v1 stand-in surfaces a copyable invite URL on the Organization settings page after `inviteMember` succeeds, and per-row on the Pending invitations list. The URL is built client-side as `<window.location.origin>/accept-invitation/<invitationId>` via `buildInviteUrl(invitationId)`. The recipient signs up (or signs in) at the URL, lands on `AcceptInvitationPage`, sees the org + inviter + role, and clicks Accept.

## Accept does not auto-switch

After `acceptInvitation`, the user lands on `/account/organization` of the org they joined, but the active org is **not** auto-switched — the user picks their context via the user menu. This intentionally avoids surprise context shifts on deep-link landing. The `useAcceptInvitation` mutation's `onSuccess` invalidates `USER_INVITATIONS_KEY` and `ORGANIZATIONS_KEY` so the new org appears in the switch sub-list immediately.

## "Last owner" predicate

`isSoleOwner({ members, userId })` returns true iff the user is the only member with role `owner` in an org with > 1 member. The Leave button is hidden in that case because the plugin will refuse and showing a button that always errors is worse than hiding it. The single-member case (the user alone in their org) also returns false — leaving an empty org is fine; the user can simply delete it.

## Permissions UI

`canManageMember(actorRole, targetRole)` mirrors the plugin defaults: owner can manage everyone (including other owners), admin can manage non-owners, member can manage no one. The page hides Change-role / Remove controls the user can't use; final enforcement is server-side via the plugin endpoints. Per-action RBAC beyond plugin defaults is deferred to `authorization-enforcement`.

## Tests

| Location | What it locks |
|---|---|
| `apps/web/src/api/organization.test.ts` | `buildInviteUrl` (with and without explicit origin), `ORG_SCOPED_QUERY_KEYS` coverage, `invalidateOrgScopedQueries` calls every scoped key + plugin keys. |
| `apps/web/src/components/layout/UserMenuPill.test.ts` | `filterOtherOrgs` (drops active, case-insensitive search, whitespace-only filter). `switchOrganization` happy path + failure path (no navigate, error surfaced). `createAndSwitchOrganization` happy path + empty-name no-op + create-failure + setActive-failure paths. |
| `apps/web/src/pages/OrganizationSettingsPage.test.ts` | `canManageMember` for every role pair. `isSoleOwner` for owner-alone, multi-owner, single-member, non-owner cases. `submitInvite` happy path + 4xx → `setError('root')` + thrown-error → `setError('root')`. |
| `apps/web/src/pages/AcceptInvitationPage.test.ts` | `handleAcceptInvitation` happy path navigates to `/account/organization`, error path surfaces message and does not navigate. Same for `handleRejectInvitation` (navigates to `/account/invitations`). `describeInvitationError` Error vs non-Error fallbacks. |
| `apps/web/src/pages/InvitationsPage.test.ts` | `filterPendingInvitations`. `performInvitationAction` happy path + error path + `onSettled` not called on failure. |
| `test/smoke/org-switching.smoke.md` | Browser-driven walkthrough for Playwright MCP: create org and land in it with empty workflows (locks the cache-invalidation regression), invite flow with email-off fallback (User A invites User B, copy invite URL, fresh-context sign-up, accept, land on `/account/organization` with User B listed), and danger-zone scenarios. |

The repo doesn't ship Playwright as a dependency (per the `web-auth-ui` convention); the smoke markdown stands in for the umbrella's two-spec Playwright requirement until a runtime is added.

## Out of scope

- **Auto-switch active org on invite-accept** or based on a deep-linked workflow URL — the user picks their context via the user menu. Surprise context shifts are deferred to a v2 polish if it becomes a real ask.
- **Polished personal-org name selection at signup.** Default remains `<email-localpart>'s workspace`; users rename in one click via `/account/organization`.
- **Email-delivered invitations.** Cross-cutting TODO; v1 surfaces the invite URL as a copyable link.
- **Avatars / profile photos.** Member rows show two-letter initials in v1.
- **Audit-log entries on invite / remove / role-change** — handled by `operational-hardening`.
- **Per-action RBAC inside an org** beyond the plugin's owner/admin/member defaults.
- **Standalone `OrgSwitcherPill` in `TopChrome`'s left section** — explicitly rejected in favor of the merged user menu.
