-- Better Auth 1.7 — backfill `account.issuer`.
--
-- WHY THIS FILE EXISTS
-- Better Auth 1.7 keys provider identities on `(issuer, accountId)` instead of
-- `providerId` alone, so `account` gains a REQUIRED `issuer` column plus a
-- unique index. The repo has no Prisma migration history — `apps/api/entrypoint.sh`
-- runs `prisma db push` on every boot — and `db push` REFUSES to add a required
-- column without a default to a populated table:
--
--   Added the required column `issuer` to the `account` table without a default
--   value. There are N rows in this table, it is not possible to execute this step.
--
-- It exits 1, and `entrypoint.sh` runs under `set -e`, so the API container will
-- not start. Run this script against the database BEFORE deploying the upgraded
-- image. It is idempotent: safe to re-run, and a no-op on a database that is
-- already migrated or has an empty `account` table.
--
-- After it completes, `prisma db push` sees the schema as already in sync and
-- the normal boot path resumes.
--
--   docker exec -i <postgres-container> psql -U conduit -d conduit < this-file.sql
--
-- ISSUER VALUES
-- Providers with no issuer of their own get a synthetic one, exactly matching
-- what `createLocalAccountIssuer` / `createOAuthAccountIssuer` write for new
-- rows (`local:<providerId>` and `local:oauth:<providerId>` respectively).
-- Conduit only ever creates three kinds of account row:
--
--   providerId = 'credential'  ->  'local:credential'
--   providerId = 'github'      ->  'local:oauth:github'
--   providerId = 'gitlab'      ->  'local:oauth:gitlab'
--
-- The generic `local:oauth:` fallback below covers any social provider added
-- between this file being written and it being run. If a real OIDC provider is
-- ever configured, its rows need the provider's actual issuer URL instead —
-- add an explicit branch rather than letting the fallback claim them.

BEGIN;

-- 1. Add nullable so the existing rows survive the ALTER.
ALTER TABLE account ADD COLUMN IF NOT EXISTS issuer text;

-- 2. Backfill. Only touches rows that have no issuer yet, so re-running after a
--    partial migration cannot overwrite a value Better Auth 1.7 already wrote.
UPDATE account
SET issuer = CASE
  WHEN "providerId" = 'credential' THEN 'local:credential'
  ELSE 'local:oauth:' || "providerId"
END
WHERE issuer IS NULL OR issuer = '';

-- 3. Collision check. `(issuer, accountId)` is about to become unique. Two rows
--    sharing a pair means one provider identity is claimed twice — most likely
--    the same person signed up twice. This RAISEs and rolls the whole thing
--    back rather than letting step 5 fail halfway; reconcile by hand, then
--    re-run. The query is the same one the upstream upgrade guide prescribes.
DO $$
DECLARE
  collisions int;
BEGIN
  SELECT count(*) INTO collisions FROM (
    SELECT issuer, "accountId"
    FROM account
    GROUP BY issuer, "accountId"
    HAVING count(*) > 1
  ) dupes;
  IF collisions > 0 THEN
    RAISE EXCEPTION
      'Better Auth 1.7 migration aborted: % (issuer, accountId) pair(s) are claimed by more than one account row. Resolve them, then re-run. Inspect with: SELECT issuer, "accountId", count(*), count(DISTINCT "userId") FROM account GROUP BY 1,2 HAVING count(*) > 1;',
      collisions;
  END IF;
END $$;

-- 4. Now that every row has a value, make it required.
ALTER TABLE account ALTER COLUMN issuer SET NOT NULL;

-- 5. The unique index Prisma's `@@unique([issuer, accountId])` generates. Named
--    to match so `db push` recognizes it as already present instead of trying
--    to create its own.
CREATE UNIQUE INDEX IF NOT EXISTS "account_issuer_accountId_key"
  ON account (issuer, "accountId");

COMMIT;
