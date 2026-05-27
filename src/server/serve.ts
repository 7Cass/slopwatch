import { createServerApp } from "./app";
import {
  assertDatabaseReady,
  type MigrationHealthChecker,
} from "../db/health";
import { createPostgresNowProjectionStore } from "../now/postgres-store";
import { createNowProjectionProvider } from "../now/projection";

export type ServerOptions = {
  host?: string;
  port?: number;
  databaseUrl?: string;
  migrationChecker?: MigrationHealthChecker;
};

export type RunningServer = {
  url: string;
  stop: () => Promise<void>;
};

export async function startServer(
  options: ServerOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";

  await assertDatabaseReady({
    config: { databaseUrl: options.databaseUrl },
    checker: options.migrationChecker,
  });

  const app = createServerApp({
    nowProvider: createNowProjectionProvider({
      databaseUrl: options.databaseUrl!,
      storeFactory: createPostgresNowProjectionStore,
    }),
  });
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
