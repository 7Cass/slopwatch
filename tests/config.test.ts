import { describe, expect, test } from "bun:test";

import { resolveRuntimeConfig } from "../src/config/runtime";

describe("runtime config", () => {
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
