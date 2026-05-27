import { afterEach, expect, test } from "bun:test";

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { buildNowProjection } from "../src/now/projection";
import { runNowStatus } from "../src/now/status";

const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;
let tmpRoots: string[] = [];

async function tempPath(...segments: string[]) {
  const root = await mkdtemp(join(tmpdir(), "slopwatch-cli-"));
  tmpRoots.push(root);

  return join(root, ...segments);
}

async function writeHealthyCodexSource(sourcePath: string) {
  await mkdir(join(sourcePath, "sessions", "2026", "05", "27"), {
    recursive: true,
  });
  await writeFile(join(sourcePath, "state_5.sqlite"), "");
  await writeFile(
    join(
      sourcePath,
      "sessions",
      "2026",
      "05",
      "27",
      "rollout-2026-05-27T10-00-00-thread-main.jsonl",
    ),
    "",
    "utf8",
  );
}

afterEach(async () => {
  const roots = tmpRoots;
  tmpRoots = [];

  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function runCli(
  args: string[],
  envOverrides: Record<string, string | undefined> = {},
) {
  const env: Record<string, string | undefined> = {
    ...Bun.env,
    NO_COLOR: "1",
  };
  delete env.DATABASE_URL;

  for (const [key, value] of Object.entries(envOverrides)) {
    if (value === undefined) {
      delete env[key];
      continue;
    }

    env[key] = value;
  }

  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

test("slopwatch CLI exposes the planned v0 command surface", async () => {
  const result = await runCli(["--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Usage: slopwatch");

  for (const command of [
    "init",
    "doctor",
    "db",
    "serve",
    "collect",
    "status",
    "sources",
    "purge",
  ]) {
    expect(result.stdout).toContain(command);
  }
});

test("db migrate requires DATABASE_URL before applying migrations", async () => {
  const result = await runCli(["db", "migrate"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("DATABASE_URL is required");
  expect(result.stderr).toContain("--database-url");
});

test("collect --fixture requires DATABASE_URL before collecting", async () => {
  const result = await runCli(["collect", "--fixture"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("DATABASE_URL is required");
  expect(result.stderr).toContain("--database-url");
});

test("collect accepts Source overrides for real Codex collection", async () => {
  const sourcePath = await tempPath("codex-source");
  const result = await runCli(["collect", "--source", sourcePath]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("DATABASE_URL is required");
  expect(result.stderr).toContain("--database-url");
  expect(result.stdout).not.toContain(
    "collect is part of the Slopwatch v0 scaffold",
  );
});

test("collect exposes an explicit Raw payload opt-in", async () => {
  const result = await runCli(["collect", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("--include-content");
  expect(result.stdout).toContain("--source");
});

test("init creates local config without copying DATABASE_URL secrets", async () => {
  const configPath = await tempPath("config", "slopwatch", "config.json");
  const result = await runCli(["init", "--config", configPath], {
    DATABASE_URL: "postgres://user:secret@localhost/slopwatch_cli",
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Config created");
  await expect(readFile(configPath, "utf8")).resolves.toBe(
    `${JSON.stringify({ sources: [] }, null, 2)}\n`,
  );
});

test("sources lists Source overrides with health", async () => {
  const detectedPath = await tempPath("detected-codex-source");
  const sourcePath = await tempPath("override-codex-source");
  await writeHealthyCodexSource(detectedPath);
  await writeHealthyCodexSource(sourcePath);

  const result = await runCli(["sources", "--source", sourcePath], {
    CODEX_HOME: detectedPath,
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain(
    `codex-local:default\tcodex-local\tconfigured override\tok\tok\t${sourcePath}`,
  );
  expect(result.stdout).toContain(sourcePath);
  expect(result.stdout).not.toContain(detectedPath);
});

test("doctor reports individual Source health", async () => {
  const missingSourcePath = await tempPath("missing-codex-source");

  const result = await runCli(["doctor", "--source", missingSourcePath]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("Sources: 1");
  expect(result.stdout).toContain(missingSourcePath);
  expect(result.stdout).toContain("missing");
});

test("status runner prints the shared Now projection", async () => {
  const lines: string[] = [];

  await runNowStatus({
    nowProvider: async () =>
      buildNowProjection({
        now: new Date("2026-05-01T10:10:00.000Z"),
        records: [
          {
            workUnitId: "work-unit-1",
            project: {
              displayName: "slopwatch-demo",
              rootPath: "/projects/slopwatch-demo",
            },
            state: "active",
            confidence: 0.7,
            explanation: "detail-only field",
            activeTimeMs: 4 * 60 * 1000,
            lastActivityAt: new Date("2026-05-01T10:04:00.000Z"),
            lastAction: "reported progress",
            toolCalls: 1,
            tokenQuality: "unavailable",
          },
        ],
      }),
    writeLine: (line) => {
      lines.push(line);
    },
  });

  expect(lines.join("\n")).toContain("Active");
  expect(lines.join("\n")).toContain("slopwatch-demo");
  expect(lines.join("\n")).toContain("reported progress");
  expect(lines.join("\n")).not.toContain("detail-only field");
});

test("status requires DATABASE_URL before reading the Now projection", async () => {
  const result = await runCli(["status"]);

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("DATABASE_URL is required");
  expect(result.stderr).toContain("--database-url");
});
