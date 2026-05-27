import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import type { RuntimeConfig } from "../config/runtime";

export type MigrationRunner = {
  migrate: (databaseUrl: string) => Promise<void>;
};

export type RunDatabaseMigrationsInput = {
  config: RuntimeConfig;
  runner?: MigrationRunner;
};

export class MissingDatabaseUrlError extends Error {
  constructor() {
    super(
      "DATABASE_URL is required. Set DATABASE_URL or pass --database-url.",
    );
    this.name = "MissingDatabaseUrlError";
  }
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultMigrationsFolder = resolve(moduleDirectory, "../../drizzle");

export async function runDatabaseMigrations({
  config,
  runner = createPostgresMigrationRunner(),
}: RunDatabaseMigrationsInput) {
  if (!config.databaseUrl) {
    throw new MissingDatabaseUrlError();
  }

  await runner.migrate(config.databaseUrl);
}

export function createPostgresMigrationRunner(
  migrationsFolder = defaultMigrationsFolder,
): MigrationRunner {
  return {
    migrate: async (databaseUrl) => {
      const client = postgres(databaseUrl, { max: 1 });

      try {
        const database = drizzle(client);
        await migrate(database, { migrationsFolder });
      } finally {
        await client.end();
      }
    },
  };
}
