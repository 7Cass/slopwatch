# Explicit database migrations

Slopwatch does not apply database migrations from `serve`. The server may check migration health and fail with a clear instruction to run `slopwatch db migrate` or `slopwatch init --migrate`, but schema changes remain explicit operator actions. This avoids surprising writes during normal dashboard startup while still keeping setup ergonomic through the init flow.

Docker Compose and smoke-test containers may make a Postgres process reachable, but they do not make the schema ready. Operators and tests still run `slopwatch db migrate` explicitly before collecting Events or serving the dashboard.
