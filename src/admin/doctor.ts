import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { dirname } from "node:path";

import type { RuntimeConfigFlags, RuntimeEnv } from "../config/runtime";
import { resolveRuntimeConfig } from "../config/runtime";
import {
  defaultUserConfigPath,
  readUserConfig,
  type UserConfigReadResult,
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
  listSources,
  type SourceDetector,
  type SourceHealthChecker,
  type SourceReport,
} from "./sources";

export type PermissionHealth = {
  status: "ok" | "missing" | "unavailable";
  message?: string;
};

export type PermissionChecker = {
  checkConfigPath: (configPath: string) => Promise<PermissionHealth>;
};

export type DoctorReport = {
  runtime: {
    status: "ok";
    bunVersion: string;
    platform: string;
  };
  config: {
    status: UserConfigReadResult["status"];
    path: string;
    message?: string;
  };
  database: DatabaseHealth;
  migration: MigrationHealth | { status: "skipped"; message: string };
  permissions: PermissionHealth;
  sources: SourceReport[];
  sourceFormat: {
    status: "ok" | "issues";
    checked: number;
  };
};

export type RunDoctorInput = {
  configPath?: string;
  env?: RuntimeEnv;
  flags?: RuntimeConfigFlags;
  readConfig?: typeof readUserConfig;
  databaseChecker?: DatabaseConnectionChecker;
  migrationChecker?: MigrationHealthChecker;
  permissionChecker?: PermissionChecker;
  sourceDetectors?: SourceDetector[];
  sourceHealthChecker?: SourceHealthChecker;
};

export async function runDoctor({
  configPath = defaultUserConfigPath(),
  env = Bun.env,
  flags = {},
  readConfig = readUserConfig,
  databaseChecker = createPostgresDatabaseConnectionChecker(),
  migrationChecker = createPostgresMigrationHealthChecker(),
  permissionChecker = createLocalPermissionChecker(),
  sourceDetectors,
  sourceHealthChecker,
}: RunDoctorInput = {}): Promise<DoctorReport> {
  const userConfig = await readConfig(configPath);
  const config = resolveRuntimeConfig({
    userConfig: userConfig.config,
    env,
    flags,
  });
  const database = await checkDatabase(config.databaseUrl, databaseChecker);
  const migration =
    database.status === "ok" && config.databaseUrl
      ? await migrationChecker.check(config.databaseUrl)
      : {
          status: "skipped" as const,
          message: "Database is not available for migration health checks.",
        };
  const sources = await listSources({
    config,
    env,
    detectors: sourceDetectors,
    healthChecker: sourceHealthChecker,
  });

  return {
    runtime: {
      status: "ok",
      bunVersion: Bun.version,
      platform: process.platform,
    },
    config: {
      status: userConfig.status,
      path: configPath,
      message:
        userConfig.status === "malformed" ? userConfig.message : undefined,
    },
    database,
    migration,
    permissions: await permissionChecker.checkConfigPath(configPath),
    sources,
    sourceFormat: {
      status: sources.every((source) => source.format.status === "ok")
        ? "ok"
        : "issues",
      checked: sources.length,
    },
  };
}

export function createLocalPermissionChecker(): PermissionChecker {
  return {
    checkConfigPath: async (configPath) => {
      try {
        await access(dirname(configPath), constants.R_OK | constants.W_OK);

        return {
          status: "ok",
        };
      } catch (error) {
        if (isNotFoundError(error)) {
          return {
            status: "missing",
            message: "Slopwatch config directory does not exist.",
          };
        }

        return {
          status: "unavailable",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
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

function isNotFoundError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
