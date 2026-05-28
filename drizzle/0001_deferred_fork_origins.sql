ALTER TABLE slopwatch_forks
  ADD COLUMN IF NOT EXISTS source_origin_fork_id text;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS slopwatch_forks_source_origin_idx
  ON slopwatch_forks (source_origin_fork_id)
  WHERE source_origin_fork_id IS NOT NULL;
