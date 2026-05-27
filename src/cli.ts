#!/usr/bin/env bun
import { Command } from "commander";

import { runFixtureCollection } from "./collect/run";
import { resolveRuntimeConfig } from "./config/runtime";
import { runDatabaseMigrations } from "./db/migrations";
import { startServer } from "./server/serve";

function scaffoldAction(commandName: string) {
  return () => {
    console.log(
      `${commandName} is part of the Slopwatch v0 scaffold and is not implemented yet.`,
    );
  };
}

function buildProgram() {
  const program = new Command();

  program
    .name("slopwatch")
    .description("Local-first observability for Codex activity.")
    .version("0.0.0");

  program
    .command("init")
    .description("Create local Slopwatch configuration.")
    .action(scaffoldAction("init"));

  program
    .command("doctor")
    .description("Inspect runtime, database, Source, and permission health.")
    .action(scaffoldAction("doctor"));

  const db = program.command("db").description("Manage Slopwatch-owned state.");
  db.command("migrate")
    .description("Apply explicit database migrations.")
    .option("--database-url <url>", "Postgres connection URL.")
    .action(async (options: { databaseUrl?: string }) => {
      try {
        await runDatabaseMigrations({
          config: resolveRuntimeConfig({
            env: Bun.env,
            flags: { databaseUrl: options.databaseUrl },
          }),
        });
        console.log("Database migrations applied.");
      } catch (error) {
        console.error(formatCliError(error));
        process.exitCode = 1;
      }
    });

  program
    .command("serve")
    .description("Start the local Slopwatch API and dashboard server.")
    .option("--host <host>", "Host to bind.", "127.0.0.1")
    .option("--port <port>", "Port to bind.", "4317")
    .option("--database-url <url>", "Postgres connection URL.")
    .option("--open", "Open the dashboard URL after startup.")
    .action(
      async (options: {
        host: string;
        port: string;
        databaseUrl?: string;
      }) => {
        try {
          const config = resolveRuntimeConfig({
            env: Bun.env,
            flags: { databaseUrl: options.databaseUrl },
          });
          const server = await startServer({
            host: options.host,
            port: Number.parseInt(options.port, 10),
            databaseUrl: config.databaseUrl,
          });

          console.log(`Slopwatch listening on ${server.url}`);
        } catch (error) {
          console.error(formatCliError(error));
          process.exitCode = 1;
        }
      },
    );

  program
    .command("collect")
    .description("Collect Events from configured Sources.")
    .option("--fixture", "Collect from the deterministic fixture Source.")
    .option("--database-url <url>", "Postgres connection URL.")
    .action(async (options: { fixture?: boolean; databaseUrl?: string }) => {
      if (!options.fixture) {
        scaffoldAction("collect")();
        return;
      }

      try {
        const summary = await runFixtureCollection({
          config: resolveRuntimeConfig({
            env: Bun.env,
            flags: { databaseUrl: options.databaseUrl },
          }),
        });

        console.log(
          `Collected ${summary.eventsProcessed} fixture Events for ${summary.workUnitsProcessed} WorkUnit.`,
        );
      } catch (error) {
        console.error(formatCliError(error));
        process.exitCode = 1;
      }
    });

  program
    .command("status")
    .description("Print the current Now projection in the terminal.")
    .action(scaffoldAction("status"));

  program
    .command("sources")
    .description("List detected and configured Sources with health.")
    .action(scaffoldAction("sources"));

  program
    .command("purge")
    .description("Purge Slopwatch-owned indexed data.")
    .option("--include-config", "Also include local Slopwatch configuration.")
    .action(scaffoldAction("purge"));

  return program;
}

function formatCliError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

await buildProgram().parseAsync();
