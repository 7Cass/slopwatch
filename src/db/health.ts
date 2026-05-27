import { readFile } from "node:fs/promises";
import { join } from "node:path";

import postgres from "postgres";

import type { RuntimeConfig } from "../config/runtime";
import { defaultMigrationsFolder, MissingDatabaseUrlError } from "./migrations";

export type MigrationHealthStatus = "ready" | "missing" | "pending";

export type MigrationHealth = {
  status: MigrationHealthStatus;
  appliedMigrations: number;
  expectedMigrations: number;
};

export type MigrationHealthChecker = {
  check: (databaseUrl: string) => Promise<MigrationHealth>;
};

export type AssertDatabaseReadyInput = {
  config: RuntimeConfig;
  checker?: MigrationHealthChecker;
};

export class DatabaseMigrationNotReadyError extends Error {
  constructor(health: MigrationHealth) {
    super(
      `Database migrations are ${health.status} (${health.appliedMigrations}/${health.expectedMigrations} applied). Run slopwatch db migrate.`,
    );
    this.name = "DatabaseMigrationNotReadyError";
  }
}

export async function assertDatabaseReady({
  config,
  checker = createPostgresMigrationHealthChecker(),
}: AssertDatabaseReadyInput) {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  const health = await checker.check(config.databaseUrl);

  if (health.status !== "ready") {
    throw new DatabaseMigrationNotReadyError(health);
  }

  return health;
}

export function createPostgresMigrationHealthChecker(
  migrationsFolder = defaultMigrationsFolder,
): MigrationHealthChecker {
  return {
    check: async (databaseUrl) => {
      const expectedMigrations = await countExpectedMigrations(
        migrationsFolder,
      );
      const client = postgres(databaseUrl, { max: 1 });

      try {
        const migrationTable = await client`
          SELECT to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS exists
        `;
        const migrationTableExists = Boolean(migrationTable[0]?.exists);

        if (!migrationTableExists) {
          return {
            status: "missing",
            appliedMigrations: 0,
            expectedMigrations,
          };
        }

        const migrationCount = await client`
          SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations
        `;
        const appliedMigrations = Number(migrationCount[0]?.count ?? 0);

        return {
          status:
            appliedMigrations < expectedMigrations ? "pending" : "ready",
          appliedMigrations,
          expectedMigrations,
        };
      } finally {
        await client.end();
      }
    },
  };
}

async function countExpectedMigrations(migrationsFolder: string) {
  const journal = JSON.parse(
    await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"),
  ) as { entries?: unknown[] };

  return journal.entries?.length ?? 0;
}
