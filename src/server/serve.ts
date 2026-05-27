import { createServerApp } from "./app";

export type ServerOptions = {
  host?: string;
  port?: number;
};

export type RunningServer = {
  url: string;
  stop: () => Promise<void>;
};

export function startServer(options: ServerOptions = {}): RunningServer {
  const host = options.host ?? "127.0.0.1";
  const app = createServerApp();
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: host,
    port: options.port ?? 4317,
  });

  return {
    url: `http://${host}:${server.port}`,
    stop: async () => {
      server.stop(true);
    },
  };
}
