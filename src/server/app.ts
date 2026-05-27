import { Hono } from "hono";

export function createServerApp() {
  const app = new Hono();

  app.get("/health", (context) =>
    context.json({
      service: "slopwatch",
      status: "ok",
    }),
  );

  return app;
}
