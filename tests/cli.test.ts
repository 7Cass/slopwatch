import { expect, test } from "bun:test";

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
