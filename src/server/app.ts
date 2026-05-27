import { Hono } from "hono";

import {
  buildNowProjection,
  type NowProjectionProvider,
} from "../now/projection";
import type { NowUpdateSource } from "./now-updates";

export type ServerAppOptions = {
  nowProvider?: NowProjectionProvider;
  nowUpdates?: NowUpdateSource;
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
  app.get("/api/now/events", (context) =>
    createNowEventsResponse({
      nowProvider,
      nowUpdates: options.nowUpdates,
      signal: context.req.raw.signal,
    }),
  );

  return app;
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
