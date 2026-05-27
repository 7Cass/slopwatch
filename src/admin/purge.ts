import postgres, { type Sql } from "postgres";

import type { RuntimeConfigFlags, RuntimeEnv } from "../config/runtime";
import { resolveRuntimeConfig } from "../config/runtime";
import {
  defaultUserConfigPath,
  readUserConfig,
  removeUserConfig,
} from "../config/local";
import { MissingDatabaseUrlError } from "../db/migrations";

export const slopwatchIndexedTables = [
  "slopwatch_inferences",
  "slopwatch_events",
  "slopwatch_work_units",
  "slopwatch_forks",
  "slopwatch_sessions",
  "slopwatch_projects",
  "slopwatch_sources",
] as const;

export type PurgeStore = {
  purgeIndexedData: () => Promise<{
    tables: string[];
  }>;
  close?: () => Promise<void>;
};

export type PurgeStoreFactory = (databaseUrl: string) => PurgeStore;

export type PurgeReport = {
  indexedData: {
    tables: string[];
  };
  config: {
    path: string;
    removed: boolean;
  };
};

export type RunPurgeInput = {
  configPath?: string;
  env?: RuntimeEnv;
  flags?: RuntimeConfigFlags;
  includeConfig?: boolean;
  readConfig?: typeof readUserConfig;
  removeConfig?: (configPath: string) => Promise<void>;
  storeFactory?: PurgeStoreFactory;
};

export async function runPurge({
  configPath = defaultUserConfigPath(),
  env = Bun.env,
  flags = {},
  includeConfig = false,
  readConfig = readUserConfig,
  removeConfig = removeUserConfig,
  storeFactory = createPostgresPurgeStore,
}: RunPurgeInput = {}): Promise<PurgeReport> {
  const userConfig = await readConfig(configPath);
  const config = resolveRuntimeConfig({
    userConfig: userConfig.config,
    env,
    flags,
  });

  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const store = storeFactory(config.databaseUrl);

  try {
    const indexedData = await store.purgeIndexedData();

    if (includeConfig) {
      await removeConfig(configPath);
    }

    return {
      indexedData,
      config: {
        path: configPath,
        removed: includeConfig,
      },
    };
  } finally {
    await store.close?.();
  }
}

export function createPostgresPurgeStore(databaseUrl: string): PurgeStore {
  const client = postgres(databaseUrl, { max: 1 });

  return new PostgresPurgeStore(client);
}

class PostgresPurgeStore implements PurgeStore {
  constructor(private readonly client: Sql) {}

  async purgeIndexedData() {
    await this.client.begin(async (transaction) => {
      await transaction`DELETE FROM slopwatch_inferences`;
      await transaction`DELETE FROM slopwatch_events`;
      await transaction`DELETE FROM slopwatch_work_units`;
      await transaction`DELETE FROM slopwatch_forks`;
      await transaction`DELETE FROM slopwatch_sessions`;
      await transaction`DELETE FROM slopwatch_projects`;
      await transaction`DELETE FROM slopwatch_sources`;
    });

    return {
      tables: [...slopwatchIndexedTables],
    };
  }

  async close() {
    await this.client.end();
  }
}
