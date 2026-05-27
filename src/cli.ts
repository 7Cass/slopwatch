#!/usr/bin/env bun
import { Command } from "commander";

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
    .action(scaffoldAction("db migrate"));

  program
    .command("serve")
    .description("Start the local Slopwatch API and dashboard server.")
    .option("--host <host>", "Host to bind.", "127.0.0.1")
    .option("--port <port>", "Port to bind.", "4317")
    .option("--open", "Open the dashboard URL after startup.")
    .action((options: { host: string; port: string }) => {
      const server = startServer({
        host: options.host,
        port: Number.parseInt(options.port, 10),
      });

      console.log(`Slopwatch listening on ${server.url}`);
    });

  program
    .command("collect")
    .description("Collect Events from configured Sources.")
    .option("--fixture", "Collect from the deterministic fixture Source.")
    .action(scaffoldAction("collect"));

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

await buildProgram().parseAsync();
