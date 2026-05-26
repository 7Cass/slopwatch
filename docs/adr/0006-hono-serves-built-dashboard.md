# Hono serves the built dashboard

In development, Vite serves the dashboard while it talks to the local Hono API. In normal `slopwatch serve` usage, Hono serves the built dashboard assets and the API/SSE endpoints from the same local origin. This gives development the Vite workflow while keeping the installed local product to one URL, one port, and no CORS setup for the dashboard.
