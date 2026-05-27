import { describe, expect, test } from "bun:test";

import { createSourcesHealthProvider } from "../src/sources/health";

describe("Sources health", () => {
  test("uses the shared Source listing model for detected and configured Sources", async () => {
    const provider = createSourcesHealthProvider({
      now: () => new Date("2026-05-01T10:10:00.000Z"),
      config: {
        sources: [
          {
            sourceKey: "codex-local:default",
            sourceType: "codex-local",
            path: "/sources/override",
          },
          {
            sourceKey: "codex-local:missing",
            sourceType: "codex-local",
            path: "/sources/missing",
          },
        ],
      },
      detectors: [
        {
          detect: async () => [
            {
              sourceKey: "codex-local:default",
              sourceType: "codex-local",
              path: "/sources/detected",
            },
          ],
        },
      ],
      healthChecker: {
        check: async (source) => ({
          status: source.path.includes("missing") ? "missing" : "ok",
        }),
      },
    });

    await expect(provider()).resolves.toEqual({
      generatedAt: new Date("2026-05-01T10:10:00.000Z"),
      sources: [
        {
          sourceKey: "codex-local:default",
          sourceType: "codex-local",
          path: "/sources/override",
          origin: "configured",
          overridden: true,
          health: { status: "ok" },
          format: { status: "ok" },
        },
        {
          sourceKey: "codex-local:missing",
          sourceType: "codex-local",
          path: "/sources/missing",
          origin: "configured",
          overridden: false,
          health: { status: "missing" },
          format: { status: "missing" },
        },
      ],
    });
  });
});
