import postgres from "postgres";

export type DatabaseStatus = "missing" | "ok" | "unreachable";

export type DatabaseHealth = {
  status: DatabaseStatus;
  message?: string;
};

export type DatabaseConnectionChecker = {
  ping: (databaseUrl: string) => Promise<DatabaseHealth>;
};

export function missingDatabaseHealth(): DatabaseHealth {
  return {
    status: "missing",
    message: "DATABASE_URL is not configured.",
  };
}

export function createPostgresDatabaseConnectionChecker(): DatabaseConnectionChecker {
  return {
    ping: async (databaseUrl) => {
      const client = postgres(databaseUrl, { max: 1 });

      try {
        await client`SELECT 1`;

        return {
          status: "ok",
        };
      } catch (error) {
        return {
          status: "unreachable",
          message: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await client.end();
      }
    },
  };
}
