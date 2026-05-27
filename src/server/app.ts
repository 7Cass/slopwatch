import { Hono } from "hono";

import {
  buildNowProjection,
  type NowProjectionProvider,
} from "../now/projection";

export type ServerAppOptions = {
  nowProvider?: NowProjectionProvider;
};

export function createServerApp(options: ServerAppOptions = {}) {
  const app = new Hono();
  const nowProvider =
    options.nowProvider ??
    (() =>
      Promise.resolve(
        buildNowProjection({
          records: [],
        }),
      ));

  app.get("/health", (context) =>
    context.json({
      service: "slopwatch",
      status: "ok",
    }),
  );

  app.get("/api/now", async (context) => context.json(await nowProvider()));

  return app;
}
