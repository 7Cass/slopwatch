# Explicit database migrations

Slopwatch does not apply database migrations from `serve`. The server may check migration health and fail with a clear instruction to run `slopwatch db migrate` or `slopwatch init --migrate`, but schema changes remain explicit operator actions. This avoids surprising writes during normal dashboard startup while still keeping setup ergonomic through the init flow.
