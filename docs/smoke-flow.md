# End-to-End Smoke Flow

The smoke flow proves the first Slopwatch vertical slice against an isolated Postgres container. It does not read or modify any real Source data.

## Prerequisites

- Bun dependencies installed.
- Docker available on `PATH`.
- Permission to bind temporary `127.0.0.1` ports for Postgres and `slopwatch serve`.

## Run

```sh
bun run smoke:e2e
```

## What It Verifies

- `slopwatch serve` checks migration health and refuses to start before explicit migration.
- The smoke creates an ephemeral `docker run` Postgres container with isolated Slopwatch-owned state.
- The smoke waits for Postgres readiness before running Slopwatch commands.
- `slopwatch db migrate` applies Drizzle migrations against the isolated Postgres container.
- `slopwatch collect --fixture` persists fixture-backed Events, one WorkUnit, and a versioned Inference.
- `slopwatch serve` starts after migration without applying migrations automatically.
- `/api/now/events` emits an SSE `now` snapshot.
- The dashboard route renders one inferred Agent card from the fixture-backed Now projection.

The test points `CODEX_HOME` at a missing temporary path so server startup and polling cannot collect host Codex Source data. The Postgres container uses isolated state and is removed after the run, including failure paths.
