import { describe, expect, test } from "bun:test";

import { join } from "node:path";

import {
  defaultMigrationsFolder,
  runDatabaseMigrations,
} from "../src/db/migrations";

describe("database migrations", () => {
  test("applies migrations explicitly using the resolved database URL", async () => {
    const calls: string[] = [];

    await runDatabaseMigrations({
      config: { databaseUrl: "postgres://localhost/slopwatch_test" },
      runner: {
        migrate: async (databaseUrl) => {
          calls.push(databaseUrl);
        },
      },
    });

    expect(calls).toEqual(["postgres://localhost/slopwatch_test"]);
  });
});

test("initial migration covers the core Slopwatch-owned state tables", async () => {
  const migrationSql = await Bun.file(
    join(defaultMigrationsFolder, "0000_initial_slopwatch_state.sql"),
  ).text();

  for (const tableName of [
    "slopwatch_sources",
    "slopwatch_projects",
    "slopwatch_sessions",
    "slopwatch_forks",
    "slopwatch_work_units",
    "slopwatch_events",
    "slopwatch_inferences",
  ]) {
    expect(migrationSql).toContain(`CREATE TABLE IF NOT EXISTS ${tableName}`);
  }
});

test("initial migration stores versioned WorkUnit Inference fields", async () => {
  const migrationSql = await Bun.file(
    join(defaultMigrationsFolder, "0000_initial_slopwatch_state.sql"),
  ).text();

  for (const column of [
    "work_unit_id uuid NOT NULL UNIQUE REFERENCES slopwatch_work_units(id)",
    "state text NOT NULL",
    "confidence real NOT NULL",
    "explanation text NOT NULL",
    "active_time_ms integer NOT NULL DEFAULT 0",
    "inference_version text NOT NULL",
    "calculated_at timestamptz NOT NULL DEFAULT now()",
  ]) {
    expect(migrationSql).toContain(column);
  }
});

test("deferred Fork origin migration stores unresolved Source origin identities", async () => {
  const migrationSql = await Bun.file(
    join(defaultMigrationsFolder, "0001_deferred_fork_origins.sql"),
  ).text();

  expect(migrationSql).toContain(
    "ADD COLUMN IF NOT EXISTS source_origin_fork_id text",
  );
  expect(migrationSql).toContain("slopwatch_forks_source_origin_idx");
});
