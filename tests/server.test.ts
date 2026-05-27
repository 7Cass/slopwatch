import { expect, test } from "bun:test";
import { createServer } from "node:net";

import { startServer } from "../src/server/serve";

async function getAvailablePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();

    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => {
        if (address && typeof address === "object") {
          resolve(address.port);
          return;
        }

        reject(new Error("Unable to reserve an available localhost port."));
      });
    });
  });
}

test("server starts on localhost and answers the health endpoint", async () => {
  const port = await getAvailablePort();
  const server = await startServer({
    host: "127.0.0.1",
    port,
    databaseUrl: "postgres://localhost/slopwatch_test",
    migrationChecker: {
      check: async () => ({
        status: "ready",
        appliedMigrations: 1,
        expectedMigrations: 1,
      }),
    },
  });

  try {
    const response = await fetch(`${server.url}/health`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "slopwatch",
      status: "ok",
    });
  } finally {
    await server.stop();
  }
});

test("server refuses to start when database migrations are pending", async () => {
  const port = await getAvailablePort();
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  const options = {
    host: "127.0.0.1",
    port,
    databaseUrl: "postgres://localhost/slopwatch_test",
    migrationChecker: {
      check: async () => ({
        status: "pending" as const,
        appliedMigrations: 0,
        expectedMigrations: 1,
      }),
    },
  } as Parameters<typeof startServer>[0] & {
    migrationChecker: {
      check: () => Promise<{
        status: "pending";
        appliedMigrations: number;
        expectedMigrations: number;
      }>;
    };
  };

  try {
    await expect(
      (async () => {
        server = await startServer(options);
      })(),
    ).rejects.toThrow("Run slopwatch db migrate");
  } finally {
    await server?.stop();
  }
});
