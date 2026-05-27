CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  source_key text NOT NULL UNIQUE,
  source_type text NOT NULL,
  path text,
  health_status text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  project_key text NOT NULL UNIQUE,
  root_path text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  source_id uuid NOT NULL REFERENCES slopwatch_sources(id),
  project_id uuid NOT NULL REFERENCES slopwatch_projects(id),
  source_session_id text NOT NULL,
  started_at timestamptz,
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS slopwatch_sessions_source_session_idx
  ON slopwatch_sessions (source_id, source_session_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_forks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  session_id uuid NOT NULL REFERENCES slopwatch_sessions(id),
  source_fork_id text NOT NULL,
  origin_fork_id uuid,
  started_at timestamptz,
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS slopwatch_forks_source_fork_idx
  ON slopwatch_forks (session_id, source_fork_id);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_work_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  project_id uuid NOT NULL REFERENCES slopwatch_projects(id),
  session_id uuid NOT NULL REFERENCES slopwatch_sessions(id),
  fork_id uuid REFERENCES slopwatch_forks(id),
  identity_key text NOT NULL UNIQUE,
  first_observed_at timestamptz,
  last_observed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS slopwatch_work_units_project_last_idx
  ON slopwatch_work_units (project_id, last_observed_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  source_id uuid NOT NULL REFERENCES slopwatch_sources(id),
  project_id uuid NOT NULL REFERENCES slopwatch_projects(id),
  session_id uuid NOT NULL REFERENCES slopwatch_sessions(id),
  fork_id uuid REFERENCES slopwatch_forks(id),
  work_unit_id uuid NOT NULL REFERENCES slopwatch_work_units(id),
  source_locator text NOT NULL,
  event_type text NOT NULL,
  observed_at timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  raw_payload text,
  parser_version text NOT NULL,
  source_version text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS slopwatch_events_source_locator_idx
  ON slopwatch_events (source_id, source_locator);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS slopwatch_events_work_unit_observed_idx
  ON slopwatch_events (work_unit_id, observed_at);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS slopwatch_inferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  work_unit_id uuid NOT NULL UNIQUE REFERENCES slopwatch_work_units(id),
  state text NOT NULL,
  confidence real NOT NULL,
  explanation text NOT NULL,
  active_time_ms integer NOT NULL DEFAULT 0,
  inference_version text NOT NULL,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
