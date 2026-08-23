# Org switching + invite flow smoke

Locks the browser-side flows owned by `org-on-signup-and-switching`: the
extended `UserMenuPill` popover, the create / switch / invite cycle, and the
invite-URL fallback while email transport is still TODO. Drive via Playwright
MCP against the dev stack (`npm run infra:up` + `npm run dev`).

## Setup

- API at `http://localhost:3000`, web at `http://localhost:5173`.
- Two fresh emails per run (e.g. `userA-${date}@conduit.test`,
  `userB-${date}@conduit.test`).
- Password: `smoke-password-123`.
- Open two separate browser contexts (or normal + incognito) so the two users
  don't share a session.

## Scenario A — create org and land in it with empty workflows

1. In context 1, sign up `userA-…@conduit.test` from
   `http://localhost:5173/sign-up`.
2. After redirect to `/`, click the user-menu pill in the top right.
   - Expect: popover opens with the **Organization** section.
   - Expect: active-org line reads `<email-localpart>'s workspace · owner`.
3. Click **Create organization**. Type `Open Source Co`, press Enter (or click
   Create).
   - Expect: popover closes, URL is `/`, and the home page renders an empty
     workflows list (no workflows from the previous org leak through —
     this is the cache-invalidation regression that the spec calls out).
4. Open the user-menu pill again. The active-org line now reads
   `Open Source Co · owner`. The Switch sub-list shows the previous personal
   workspace.
5. Click the personal workspace in the Switch sub-list.
   - Expect: popover closes, URL is `/`, home renders the original
     workspace's workflows (if any). Active-org line in the popover now
     shows the personal workspace again.

## Scenario B — invite flow with email-off fallback

1. In context 1, signed in as User A, navigate to `/account/organization`.
   - Expect: header reads `<active org name>`. The badge on the right shows
     `OWNER`. The Members list contains only User A as `owner`.
2. In the **Invite member** form, type `userB-…@conduit.test` and leave the
   role at `member`. Click **Send**.
   - Expect: a status banner appears below the form reading
     `Invitation created · share this link with userB-…`. A copyable invite
     URL is rendered. Click **Copy** — confirm via the OS clipboard or the
     button label flipping to `Copied`.
3. The Pending invitations section now contains a row for User B, with
   buttons **Copy invite URL** and **Revoke**. Copy the URL and keep it
   for context 2.
4. In context 2 (fresh browser), open the invite URL.
   - Expect: redirected to `/sign-in?next=%2Faccept-invitation%2F…` because
     `RequireAuth` boots and User B isn't signed in.
5. Click **Create account**, sign up User B with the email used in step 2 (the
   plugin enforces email match on accept).
6. After redirect to `/`, navigate manually to the invite URL again
   (or rely on the `?next` round-trip if it already routed automatically).
   - Expect: `Invitation.` page renders the org name, the inviter (User A's
     email), and the role `member`. Two buttons: **Reject** and
     **Accept invitation**.
7. Click **Accept invitation**.
   - Expect: redirected to `/account/organization`. The Members list now
     contains User B as `member`. (User B's _active_ org is still their
     personal workspace per spec — accepting does not auto-switch.)
8. Open the user-menu pill in context 2. The Switch sub-list now contains
   the org User B was just invited to. Switch to it.
   - Expect: home page renders the workflows of that org (initially none
     unless User A populated some).
9. Back in context 1, refresh `/account/organization`. The pending
   invitation row for User B should be gone (or marked accepted).

## Scenario C — danger zone

1. As User A in their owner-org, scroll to `Danger zone`.
   - Expect: a `Leave organization` button is **hidden** (User A is the
     sole owner of an org with members; the spec hides buttons that would
     always error). A `Delete organization` button is visible.
2. Click `Delete organization`. A typed-name confirmation appears.
3. Type the org name exactly, click `Permanently delete`.
   - Expect: redirect to `/`. The user-menu pill's Switch sub-list no
     longer contains that org.

## Notes

- The pill _label_ on the topbar must remain unchanged — short, single
  status dot, name/email truncated at 180px. Org context lives only in the
  popover.
- The `Pending invitations` link inside the popover must be hidden (or the
  numeric badge must be absent) when the count is 0.
- Switching org from the popover must invalidate every org-scoped query
  cache key. If you can navigate away after switching and the previous org's
  workflows still render, the cache invalidation is broken.
