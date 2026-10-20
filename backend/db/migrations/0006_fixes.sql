-- ResumeIQ database fixes found while verifying B4 against the live project.
--
-- Forward-only: run after 0005_analysis.sql. NOT applied by the repository.
-- Both statements are safe to re-run (SET DEFAULT is idempotent; the index uses
-- IF NOT EXISTS).
--
-- 1. 0005 aligned the targets.length *check* to the wire ('one_page'/'two_page')
--    but left the column default at 'one-page', an invalid value under the new
--    constraint. Any insert that omitted `length` therefore failed with 23514.
-- 2. jobs.target_id is a foreign key added by 0005 with no index whose leading
--    column is target_id. The composite jobs_target_created_idx starts with
--    user_id, so Postgres cannot use it for a target-only lookup (and the
--    performance advisor reports an unindexed foreign key).

ALTER TABLE public.targets
  ALTER COLUMN length SET DEFAULT 'one_page';

CREATE INDEX IF NOT EXISTS jobs_target_idx
  ON public.jobs (target_id);
