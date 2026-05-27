import { expect, test } from "bun:test";

const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;

async function runCli(args: string[]) {
  const proc = Bun.spawn(["bun", "run", cliPath, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...Bun.env, NO_COLOR: "1" },
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
