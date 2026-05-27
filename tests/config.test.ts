import { describe, expect, test } from "bun:test";

import { resolveRuntimeConfig } from "../src/config/runtime";

describe("runtime config", () => {
  test("resolves defaults, user-local config, environment, and flags by precedence", () => {
    expect(
      resolveRuntimeConfig({
        defaults: {
          sources: [
            {
              sourceKey: "codex-local:/default/.codex",
              sourceType: "codex-local",
              path: "/default/.codex",
            },
          ],
        },
        userConfig: {
          databaseUrl: "postgres://config-db/slopwatch",
          sources: [
            {
              sourceKey: "codex-local:/config/.codex",
              sourceType: "codex-local",
              path: "/config/.codex",
            },
          ],
        },
        env: { DATABASE_URL: "postgres://env-db/slopwatch" },
        flags: {
          databaseUrl: "postgres://flag-db/slopwatch",
          sources: [
            {
              sourceKey: "codex-local:/flag/.codex",
              sourceType: "codex-local",
              path: "/flag/.codex",
            },
          ],
        },
      }),
    ).toEqual({
      databaseUrl: "postgres://flag-db/slopwatch",
      sources: [
        {
          sourceKey: "codex-local:/flag/.codex",
          sourceType: "codex-local",
          path: "/flag/.codex",
        },
      ],
    });

    expect(
      resolveRuntimeConfig({
        defaults: { databaseUrl: "postgres://default-db/slopwatch" },
        userConfig: { databaseUrl: "postgres://config-db/slopwatch" },
        env: { DATABASE_URL: "postgres://env-db/slopwatch" },
        flags: {},
      }).databaseUrl,
    ).toBe("postgres://env-db/slopwatch");

    expect(
      resolveRuntimeConfig({
        defaults: { databaseUrl: "postgres://default-db/slopwatch" },
        userConfig: { databaseUrl: "postgres://config-db/slopwatch" },
        env: {},
        flags: {},
      }).databaseUrl,
    ).toBe("postgres://config-db/slopwatch");

    expect(
      resolveRuntimeConfig({
        defaults: { databaseUrl: "postgres://default-db/slopwatch" },
        env: {},
        flags: {},
      }).databaseUrl,
    ).toBe("postgres://default-db/slopwatch");
  });

  test("resolves DATABASE_URL with CLI flags taking precedence over environment", () => {
    expect(
      resolveRuntimeConfig({
        env: { DATABASE_URL: "postgres://env-db/slopwatch" },
        flags: { databaseUrl: "postgres://flag-db/slopwatch" },
      }).databaseUrl,
    ).toBe("postgres://flag-db/slopwatch");

    expect(
      resolveRuntimeConfig({
        env: { DATABASE_URL: "postgres://env-db/slopwatch" },
        flags: {},
      }).databaseUrl,
    ).toBe("postgres://env-db/slopwatch");
  });
});
