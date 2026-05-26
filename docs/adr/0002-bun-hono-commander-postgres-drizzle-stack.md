# Bun Hono Commander Postgres Drizzle stack

Slopwatch v0 uses a Bun-first TypeScript stack with Commander for the CLI, Hono for the local API, Server-Sent Events for live dashboard updates, React and Vite for the dashboard, and Postgres with Drizzle for persistence and migrations. This accepts more local setup than an embedded database or script-only tool, but gives the vertical slice a real database schema, explicit migrations, a local HTTP boundary, and live UI behavior from the start.
