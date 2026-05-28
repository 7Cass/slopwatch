# Local Development

Slopwatch uses Postgres for Slopwatch-owned state. Docker Compose starts the local Postgres process; the application still uses the existing Postgres/Drizzle persistence implementation.

## Prerequisites

- Bun dependencies installed.
- Docker available on `PATH`.
- Permission to bind `127.0.0.1:5432` for local Postgres and `127.0.0.1:4317` for `slopwatch serve`.

## Start Postgres

```sh
docker compose up -d postgres
```

Use this stable `DATABASE_URL` for local commands:

```sh
export DATABASE_URL=postgres://slopwatch:slopwatch@127.0.0.1:5432/slopwatch
```

## Prepare Slopwatch-Owned State

Apply migrations explicitly:

```sh
bun run slopwatch db migrate
```

Collect deterministic fixture Events for a quick local dashboard:

```sh
bun run slopwatch collect --fixture
```

To collect real Source Events instead, omit `--fixture`:

```sh
bun run slopwatch collect
```

Collect reads Sources and records Events in Slopwatch-owned state. It must not modify Source data.

## Serve The Dashboard

```sh
bun run slopwatch serve
```

The dashboard and API bind to `127.0.0.1:4317` by default. `serve` checks migration health and does not apply migrations automatically.

## Stop Postgres

```sh
docker compose down
```

To remove the local Slopwatch-owned Postgres volume as well:

```sh
docker compose down --volumes
```
