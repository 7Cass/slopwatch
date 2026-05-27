# End-to-End Smoke Flow

The smoke flow proves the first Slopwatch vertical slice against an isolated local Postgres cluster. It does not read or modify any real Source data.

## Prerequisites

- Bun dependencies installed.
- `initdb` and `pg_ctl` available on `PATH`. On macOS with Postgres.app, add `/Applications/Postgres.app/Contents/Versions/latest/bin` to `PATH`.
- Permission to bind temporary `127.0.0.1` ports for Postgres and `slopwatch serve`.

## Run

```sh
bun run smoke:e2e
```

## What It Verifies

- `slopwatch serve` checks migration health and refuses to start before explicit migration.
- `slopwatch db migrate` applies Drizzle migrations against a disposable Postgres data directory.
- `slopwatch collect --fixture` persists fixture-backed Events, one WorkUnit, and a versioned Inference.
- `slopwatch serve` starts after migration without applying migrations automatically.
- `/api/now/events` emits an SSE `now` snapshot.
- The dashboard route renders one inferred Agent card from the fixture-backed Now projection.

The test points `CODEX_HOME` at a missing temporary path so server startup and polling cannot collect host Codex Source data. Temporary Postgres files and Source paths are removed after the run.
