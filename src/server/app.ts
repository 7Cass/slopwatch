import { Hono } from "hono";
import { serveStatic } from "hono/bun";

import type { AgentDetailProvider } from "../agents/detail";
import {
  buildNowProjection,
  type NowProjectionProvider,
} from "../now/projection";
import type { NowUpdateSource } from "./now-updates";

export type ServerAppOptions = {
  nowProvider?: NowProjectionProvider;
  agentDetailProvider?: AgentDetailProvider;
  nowUpdates?: NowUpdateSource;
  dashboardAssetsPath?: string;
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
  app.get("/api/agents/:workUnitId", async (context) => {
    const detail = await options.agentDetailProvider?.(
      context.req.param("workUnitId"),
    );

    if (!detail) {
      return context.json({ message: "Agent not found" }, 404);
    }

    return context.json(detail);
  });
  app.get("/api/now/events", (context) =>
    createNowEventsResponse({
      nowProvider,
      nowUpdates: options.nowUpdates,
      signal: context.req.raw.signal,
    }),
  );

  registerDashboardRoutes({
    app,
    dashboardAssetsPath: options.dashboardAssetsPath ?? "./dist/dashboard",
  });

  return app;
}

function registerDashboardRoutes({
  app,
  dashboardAssetsPath,
}: {
  app: Hono;
  dashboardAssetsPath: string;
}) {
  const staticFiles = serveStatic({ root: dashboardAssetsPath });
  const indexFallback = serveStatic({
    root: dashboardAssetsPath,
    path: "index.html",
  });

  app.get("*", async (context, next) => {
    if (isReservedServerPath(context.req.path)) {
      await next();
      return;
    }

    return staticFiles(context, next);
  });

  app.get("*", async (context, next) => {
    if (isReservedServerPath(context.req.path)) {
      await next();
      return;
    }

    return indexFallback(context, next);
  });
}

function isReservedServerPath(path: string) {
  return path === "/health" || path === "/api" || path.startsWith("/api/");
}

function createNowEventsResponse({
  nowProvider,
  nowUpdates,
  signal,
}: {
  nowProvider: NowProjectionProvider;
  nowUpdates?: NowUpdateSource;
  signal: AbortSignal;
}) {
  const encoder = new TextEncoder();
  let closed = false;
  let cleanup = () => {};
  let writeQueue = Promise.resolve();

  const stream = new ReadableStream({
    start: (controller) => {
      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();

        try {
          controller.close();
        } catch {
          // The stream may already be closed by client cancellation.
        }
      };

      const writeNow = () => {
        writeQueue = writeQueue
          .then(async () => {
            if (closed) {
              return;
            }

            const projection = await nowProvider();

            if (closed) {
              return;
            }

            controller.enqueue(
              encoder.encode(
                formatSseEvent({
                  event: "now",
                  data: JSON.stringify(projection),
                }),
              ),
            );
          })
          .catch((error) => {
            if (!closed) {
              closed = true;
              cleanup();
              controller.error(error);
            }
          });
      };

      cleanup = nowUpdates?.subscribe(writeNow) ?? (() => {});
      signal.addEventListener("abort", close, { once: true });
      writeNow();
    },
    cancel: () => {
      closed = true;
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream",
    },
  });
}

function formatSseEvent({
  event,
  data,
}: {
  event: string;
  data: string;
}) {
  const dataLines = data
    .split(/\r\n|\r|\n/)
    .map((line) => `data: ${line}`)
    .join("\n");

  return `event: ${event}\n${dataLines}\n\n`;
}
