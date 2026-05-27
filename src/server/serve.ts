import { createServerApp } from "./app";
import {
  createAgentDetailProvider,
  type AgentDetailProvider,
} from "../agents/detail";
import { createPostgresAgentDetailStore } from "../agents/postgres-store";
import { runFixtureCollection } from "../collect/run";
import type { RuntimeConfig } from "../config/runtime";
import {
  assertDatabaseReady,
  type MigrationHealthChecker,
} from "../db/health";
import { createPostgresNowProjectionStore } from "../now/postgres-store";
import {
  createNowProjectionProvider,
  type NowProjectionProvider,
} from "../now/projection";
import { createNowUpdateBus } from "./now-updates";

export type CollectionRunner = ({
  config,
}: {
  config: RuntimeConfig;
}) => Promise<unknown>;

export type ServerOptions = {
  host?: string;
  port?: number;
  databaseUrl?: string;
  migrationChecker?: MigrationHealthChecker;
  collectionRunner?: CollectionRunner;
  nowProvider?: NowProjectionProvider;
  agentDetailProvider?: AgentDetailProvider;
  pollIntervalMs?: number;
};

export type RunningServer = {
  url: string;
  stop: () => Promise<void>;
};

const defaultPollIntervalMs = 5_000;

export async function startServer(
  options: ServerOptions = {},
): Promise<RunningServer> {
  const host = options.host ?? "127.0.0.1";
  const config = { databaseUrl: options.databaseUrl };
  const collectionRunner = options.collectionRunner ?? runFixtureCollection;

  await assertDatabaseReady({
    config,
    checker: options.migrationChecker,
  });
  await collectionRunner({ config });

  const nowUpdates = createNowUpdateBus();
  const app = createServerApp({
    nowProvider:
      options.nowProvider ??
      createNowProjectionProvider({
        databaseUrl: options.databaseUrl!,
        storeFactory: createPostgresNowProjectionStore,
      }),
    agentDetailProvider:
      options.agentDetailProvider ??
      createAgentDetailProvider({
        databaseUrl: options.databaseUrl!,
        storeFactory: createPostgresAgentDetailStore,
      }),
    nowUpdates,
  });
  const server = Bun.serve({
    fetch: app.fetch,
    hostname: host,
    port: options.port ?? 4317,
  });
  let collectionInProgress = false;
  const poll = setInterval(() => {
    if (collectionInProgress) {
      return;
    }

    collectionInProgress = true;

    void collectionRunner({ config })
      .then(() => {
        nowUpdates.publish();
      })
      .catch((error) => {
        console.error(formatPollingError(error));
      })
      .finally(() => {
        collectionInProgress = false;
      });
  }, options.pollIntervalMs ?? defaultPollIntervalMs);

  return {
    url: `http://${host}:${server.port}`,
    stop: async () => {
      clearInterval(poll);
      nowUpdates.close();
      server.stop(true);
    },
  };
}

function formatPollingError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
