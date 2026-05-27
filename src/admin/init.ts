import type { RuntimeConfigFlags, RuntimeEnv } from "../config/runtime";
import { resolveRuntimeConfig } from "../config/runtime";
import {
  defaultUserConfigPath,
  readUserConfig,
  writeUserConfig,
} from "../config/local";
import {
  createPostgresDatabaseConnectionChecker,
  missingDatabaseHealth,
  type DatabaseConnectionChecker,
  type DatabaseHealth,
} from "./database";
import {
  createPostgresMigrationHealthChecker,
  type MigrationHealth,
  type MigrationHealthChecker,
} from "../db/health";
import {
  createPostgresMigrationRunner,
  MissingDatabaseUrlError,
  runDatabaseMigrations,
  type MigrationRunner,
} from "../db/migrations";

export type InitReport = {
  config: {
    path: string;
    created: boolean;
  };
  database: DatabaseHealth;
  migration: MigrationHealth | { status: "skipped"; message: string };
};

export type RunInitInput = {
  configPath?: string;
  env?: RuntimeEnv;
  flags?: RuntimeConfigFlags;
  migrate?: boolean;
  readConfig?: typeof readUserConfig;
  writeConfig?: typeof writeUserConfig;
  databaseChecker?: DatabaseConnectionChecker;
  migrationChecker?: MigrationHealthChecker;
  migrationRunner?: MigrationRunner;
};

export async function runInit({
  configPath = defaultUserConfigPath(),
  env = Bun.env,
  flags = {},
  migrate = false,
  readConfig = readUserConfig,
  writeConfig = writeUserConfig,
  databaseChecker = createPostgresDatabaseConnectionChecker(),
  migrationChecker = createPostgresMigrationHealthChecker(),
  migrationRunner = createPostgresMigrationRunner(),
}: RunInitInput = {}): Promise<InitReport> {
  const userConfig = await readConfig(configPath);

  if (userConfig.status === "malformed") {
    throw new Error(userConfig.message);
  }

  const config = resolveRuntimeConfig({
    userConfig: userConfig.config,
    env,
    flags,
  });
  const created = userConfig.status === "missing";

  if (created) {
    await writeConfig(
      {
        sources: flags.sources ?? userConfig.config.sources ?? [],
      },
      configPath,
    );
  }

  const database = await checkDatabase(config.databaseUrl, databaseChecker);

  if (!migrate) {
    return {
      config: {
        path: configPath,
        created,
      },
      database,
      migration:
        database.status === "ok" && config.databaseUrl
          ? await migrationChecker.check(config.databaseUrl)
          : {
              status: "skipped",
              message: "Migration was not requested.",
            },
    };
  }

  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  if (database.status !== "ok") {
    throw new Error(
      database.message ??
        "Database must be reachable before migrations can be applied.",
    );
  }

  await runDatabaseMigrations({
    config,
    runner: migrationRunner,
  });

  return {
    config: {
      path: configPath,
      created,
    },
    database,
    migration: await migrationChecker.check(config.databaseUrl),
  };
}

async function checkDatabase(
  databaseUrl: string | undefined,
  databaseChecker: DatabaseConnectionChecker,
) {
  if (!databaseUrl) {
    return missingDatabaseHealth();
  }

  return databaseChecker.ping(databaseUrl);
}
