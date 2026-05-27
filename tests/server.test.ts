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
  const server = startServer({ host: "127.0.0.1", port });

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
