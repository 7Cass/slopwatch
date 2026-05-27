import { expect, test } from "bun:test";

import { buildNowProjection } from "../src/now/projection";
import { runNowStatus } from "../src/now/status";

const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;

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

test("collect exposes an explicit Raw payload opt-in", async () => {
  const result = await runCli(["collect", "--help"]);

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("--include-content");
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
