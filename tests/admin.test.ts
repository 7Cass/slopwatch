import { afterEach, describe, expect, test } from "bun:test";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import { MissingDatabaseUrlError } from "../src/db/migrations";
import { runInit } from "../src/admin/init";
import { runDoctor } from "../src/admin/doctor";
import {
  createLocalSourceHealthChecker,
  listSources,
} from "../src/admin/sources";
import { runPurge, slopwatchIndexedTables } from "../src/admin/purge";

let tmpRoots: string[] = [];

async function tempConfigPath() {
  const root = await mkdtemp(join(tmpdir(), "slopwatch-admin-"));
  tmpRoots.push(root);

  return join(root, "config", "slopwatch", "config.json");
}

afterEach(async () => {
  const roots = tmpRoots;
  tmpRoots = [];

  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("init", () => {
  test("creates user-local config and reports partial health without a database", async () => {
    const configPath = await tempConfigPath();

    const report = await runInit({
      configPath,
      env: {},
      flags: {},
    });

    expect(report.config).toEqual({
      path: configPath,
      created: true,
    });
    expect(report.database.status).toBe("missing");
    expect(report.migration.status).toBe("skipped");
    await expect(readFile(configPath, "utf8")).resolves.toBe(
      `${JSON.stringify({ sources: [] }, null, 2)}\n`,
    );
  });

  test("does not copy DATABASE_URL from environment or flags into local config", async () => {
    const configPath = await tempConfigPath();

    await runInit({
      configPath,
      env: { DATABASE_URL: "postgres://env-secret/slopwatch" },
      flags: { databaseUrl: "postgres://flag-secret/slopwatch" },
      databaseChecker: {
        ping: async () => ({ status: "ok" }),
      },
      migrationChecker: {
        check: async () => ({
          status: "ready",
          appliedMigrations: 1,
          expectedMigrations: 1,
        }),
      },
    });

    const config = JSON.parse(await readFile(configPath, "utf8"));

    expect(config).toEqual({ sources: [] });
  });

  test("requires a database and applies migrations only when migration is enabled", async () => {
    const configPath = await tempConfigPath();
    const migratedUrls: string[] = [];

    await expect(
      runInit({
        configPath,
        env: {},
        flags: {},
        migrate: true,
      }),
    ).rejects.toThrow(MissingDatabaseUrlError);

    const report = await runInit({
      configPath,
      env: {},
      flags: { databaseUrl: "postgres://localhost/slopwatch" },
      migrate: true,
      migrationRunner: {
        migrate: async (databaseUrl) => {
          migratedUrls.push(databaseUrl);
        },
      },
      databaseChecker: {
        ping: async () => ({ status: "ok" }),
      },
      migrationChecker: {
        check: async () => ({
          status: "ready",
          appliedMigrations: 1,
          expectedMigrations: 1,
        }),
      },
    });

    expect(migratedUrls).toEqual(["postgres://localhost/slopwatch"]);
    expect(report.migration.status).toBe("ready");
  });
});

describe("doctor", () => {
  test("reports health without mutating local config or Sources", async () => {
    const configPath = await tempConfigPath();
    const originalConfig = `${JSON.stringify(
      {
        sources: [
          {
            sourceKey: "codex-local:override",
            sourceType: "codex-local",
            path: "/sources/override",
          },
        ],
      },
      null,
      2,
    )}\n`;
    await mkdir(dirname(configPath), { recursive: true });
    await writeFile(configPath, originalConfig, "utf8");

    const report = await runDoctor({
      configPath,
      env: { DATABASE_URL: "postgres://localhost/slopwatch" },
      databaseChecker: {
        ping: async () => ({ status: "ok" }),
      },
      migrationChecker: {
        check: async () => ({
          status: "ready",
          appliedMigrations: 1,
          expectedMigrations: 1,
        }),
      },
      permissionChecker: {
        checkConfigPath: async () => ({ status: "ok" }),
      },
      sourceDetectors: [
        {
          detect: async () => [
            {
              sourceKey: "codex-local:detected",
              sourceType: "codex-local",
              path: "/sources/detected",
            },
          ],
        },
      ],
      sourceHealthChecker: {
        check: async (source) => ({
          status: source.path.includes("override") ? "malformed" : "ok",
        }),
      },
    });

    expect(report.runtime.status).toBe("ok");
    expect(report.config.status).toBe("ok");
    expect(report.database.status).toBe("ok");
    expect(report.migration).toMatchObject({ status: "ready" });
    expect(report.permissions.status).toBe("ok");
    expect(report.sources.map((source) => source.sourceKey)).toEqual([
      "codex-local:detected",
      "codex-local:override",
    ]);
    expect(report.sourceFormat).toEqual({ status: "issues", checked: 2 });
    await expect(readFile(configPath, "utf8")).resolves.toBe(originalConfig);
  });
});

describe("sources", () => {
  test("lists detected and configured Source overrides with health", async () => {
    const sources = await listSources({
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

    expect(sources).toEqual([
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
    ]);
  });

  test("separates readable Source path health from Source format health", async () => {
    const configPath = await tempConfigPath();
    const sourcePath = dirname(configPath);
    const checker = createLocalSourceHealthChecker();
    await mkdir(sourcePath, { recursive: true });

    const report = await checker.check({
      sourceType: "codex-local",
      path: sourcePath,
    });

    expect(report).toEqual({
      health: { status: "ok" },
      format: {
        status: "malformed",
        message: "Codex local Source must contain sessions/ or history.jsonl.",
      },
    });

    await mkdir(join(sourcePath, "sessions"));

    await expect(
      checker.check({
        sourceType: "codex-local",
        path: sourcePath,
      }),
    ).resolves.toEqual({
      health: { status: "ok" },
      format: { status: "ok" },
    });
  });
});

describe("purge", () => {
  test("deletes Slopwatch-owned indexed data and includes config only when requested", async () => {
    const configPath = await tempConfigPath();
    const databaseUrls: string[] = [];
    const removedConfigPaths: string[] = [];
    let closed = 0;

    const purge = (includeConfig: boolean) =>
      runPurge({
        configPath,
        env: { DATABASE_URL: "postgres://localhost/slopwatch" },
        includeConfig,
        removeConfig: async (path) => {
          removedConfigPaths.push(path);
        },
        storeFactory: (databaseUrl) => {
          databaseUrls.push(databaseUrl);

          return {
            purgeIndexedData: async () => ({
              tables: [...slopwatchIndexedTables],
            }),
            close: async () => {
              closed += 1;
            },
          };
        },
      });

    const defaultReport = await purge(false);

    expect(defaultReport.indexedData.tables).toEqual([
      "slopwatch_inferences",
      "slopwatch_events",
      "slopwatch_work_units",
      "slopwatch_forks",
      "slopwatch_sessions",
      "slopwatch_projects",
      "slopwatch_sources",
    ]);
    expect(defaultReport.config.removed).toBe(false);
    expect(removedConfigPaths).toEqual([]);

    const explicitReport = await purge(true);

    expect(explicitReport.config).toEqual({
      path: configPath,
      removed: true,
    });
    expect(removedConfigPaths).toEqual([configPath]);
    expect(databaseUrls).toEqual([
      "postgres://localhost/slopwatch",
      "postgres://localhost/slopwatch",
    ]);
    expect(closed).toBe(2);
  });
});
