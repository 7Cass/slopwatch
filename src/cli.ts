#!/usr/bin/env bun
import { Command } from "commander";

import { runDoctor } from "./admin/doctor";
import { runInit } from "./admin/init";
import { runPurge } from "./admin/purge";
import { listSources } from "./admin/sources";
import { runCodexLocalCollection, runFixtureCollection } from "./collect/run";
import {
  formatCollectionWindow,
  parseCollectionWindow,
} from "./collect/window";
import { defaultUserConfigPath, readUserConfig } from "./config/local";
import {
  resolveRuntimeConfig,
  type RuntimeConfig,
  type RuntimeConfigFlags,
  type SourceConfig,
} from "./config/runtime";
import {
  MissingDatabaseUrlError,
  runDatabaseMigrations,
} from "./db/migrations";
import { createPostgresNowProjectionStore } from "./now/postgres-store";
import { createNowProjectionProvider } from "./now/projection";
import { runNowStatus } from "./now/status";
import {
  startServer,
  type RunningServer,
  type ServerOptions,
} from "./server/serve";

export type CliDependencies = {
  startServer?: (options: ServerOptions) => Promise<RunningServer>;
  openDashboardUrl?: (url: string) => Promise<void>;
  writeLine?: (line: string) => void;
  writeError?: (line: string) => void;
};

function scaffoldAction(commandName: string) {
  return () => {
    console.log(
      `${commandName} is part of the Slopwatch v0 scaffold and is not implemented yet.`,
    );
  };
}

export function buildProgram(dependencies: CliDependencies = {}) {
  const serveDependencies = {
    startServer,
    openDashboardUrl,
    writeLine: (line: string) => console.log(line),
    writeError: (line: string) => console.error(line),
    ...dependencies,
  };
  const program = new Command();

  program
    .name("slopwatch")
    .description("Local-first observability for Codex activity.")
    .version("0.0.0");

  program
    .command("init")
    .description("Create local Slopwatch configuration.")
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .option(
      "--source <path>",
      "Codex local Source path override.",
      collectValue,
      [],
    )
    .option("--migrate", "Apply database migrations explicitly during init.")
    .action(
      async (options: {
        config?: string;
        databaseUrl?: string;
        source: string[];
        migrate?: boolean;
      }) => {
        try {
          const report = await runInit({
            configPath: options.config,
            env: Bun.env,
            flags: flagsFromOptions(options),
            migrate: options.migrate ?? false,
          });

          printInitReport(report);
        } catch (error) {
          console.error(formatCliError(error));
          process.exitCode = 1;
        }
      },
    );

  program
    .command("doctor")
    .description("Inspect runtime, database, Source, and permission health.")
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .option(
      "--source <path>",
      "Codex local Source path override.",
      collectValue,
      [],
    )
    .action(
      async (options: {
        config?: string;
        databaseUrl?: string;
        source: string[];
      }) => {
        try {
          const report = await runDoctor({
            configPath: options.config,
            env: Bun.env,
            flags: flagsFromOptions(options),
          });

          printDoctorReport(report);
        } catch (error) {
          console.error(formatCliError(error));
          process.exitCode = 1;
        }
      },
    );

  const db = program.command("db").description("Manage Slopwatch-owned state.");
  db.command("migrate")
    .description("Apply explicit database migrations.")
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .action(async (options: { config?: string; databaseUrl?: string }) => {
      try {
        await runDatabaseMigrations({
          config: await resolveCommandConfig(options),
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
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .option("--open", "Open the dashboard URL after startup.")
    .action(
      async (options: {
        host: string;
        port: string;
        config?: string;
        databaseUrl?: string;
        open?: boolean;
      }) => {
        try {
          const config = await resolveCommandConfig(options);
          const server = await serveDependencies.startServer({
            host: options.host,
            port: Number.parseInt(options.port, 10),
            config,
          });

          if (!isLocalhostHost(options.host)) {
            serveDependencies.writeError(
              formatNetworkExposureWarning(options.host),
            );
          }

          serveDependencies.writeLine(`Slopwatch dashboard: ${server.url}`);

          if (options.open) {
            try {
              await serveDependencies.openDashboardUrl(server.url);
            } catch (error) {
              serveDependencies.writeError(
                formatOpenDashboardWarning(server.url, error),
              );
            }
          }
        } catch (error) {
          serveDependencies.writeError(formatCliError(error));
          process.exitCode = 1;
        }
      },
    );

  program
    .command("collect")
    .description("Collect Events from configured Sources.")
    .option("--fixture", "Collect from the deterministic fixture Source.")
    .option(
      "--since <value>",
      "Backfill Events since an ISO timestamp or a window like 30m, 2h, or 7d.",
    )
    .option(
      "--include-content",
      "Store Raw payload when the Source provides opt-in source text.",
    )
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .option(
      "--source <path>",
      "Codex local Source path override.",
      collectValue,
      [],
    )
    .action(
      async (options: {
        fixture?: boolean;
        since?: string;
        includeContent?: boolean;
        config?: string;
        databaseUrl?: string;
        source: string[];
      }) => {
        try {
          const collectionWindow = parseCollectionWindow(options.since);
          const config = await resolveCommandConfig(options);

          if (!options.fixture) {
            const summary = await runCodexLocalCollection({
              config,
              includeContent: options.includeContent ?? false,
              collectionWindow,
            });

            console.log(
              `Collected ${summary.eventsProcessed} Events from ${summary.sourceKeys.length} Codex local Source${summary.sourceKeys.length === 1 ? "" : "s"}${formatCollectionWindow(summary.collectionWindow)}.`,
            );
            return;
          }

          const summary = await runFixtureCollection({
            config,
            includeContent: options.includeContent ?? false,
            collectionWindow,
          });

          console.log(
            `Collected ${summary.eventsProcessed} fixture Events for ${summary.workUnitsProcessed} WorkUnit${formatCollectionWindow(summary.collectionWindow)}.`,
          );
        } catch (error) {
          console.error(formatCliError(error));
          process.exitCode = 1;
        }
      },
    );

  program
    .command("status")
    .description("Print the current Now projection in the terminal.")
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .action(async (options: { config?: string; databaseUrl?: string }) => {
      try {
        const config = await resolveCommandConfig(options);

        if (!config.databaseUrl) {
          throw new MissingDatabaseUrlError();
        }

        await runNowStatus({
          nowProvider: createNowProjectionProvider({
            databaseUrl: config.databaseUrl,
            storeFactory: createPostgresNowProjectionStore,
          }),
        });
      } catch (error) {
        console.error(formatCliError(error));
        process.exitCode = 1;
      }
    });

  program
    .command("sources")
    .description("List detected and configured Sources with health.")
    .option("--config <path>", "User-local Slopwatch config path.")
    .option(
      "--source <path>",
      "Codex local Source path override.",
      collectValue,
      [],
    )
    .action(async (options: { config?: string; source: string[] }) => {
      try {
        const config = await resolveCommandConfig(options);
        const sources = await listSources({
          config,
          env: Bun.env,
        });

        printSources(sources);
      } catch (error) {
        console.error(formatCliError(error));
        process.exitCode = 1;
      }
    });

  program
    .command("purge")
    .description("Purge Slopwatch-owned indexed data.")
    .option("--config <path>", "User-local Slopwatch config path.")
    .option("--database-url <url>", "Postgres connection URL.")
    .option("--include-config", "Also include local Slopwatch configuration.")
    .action(
      async (options: {
        config?: string;
        databaseUrl?: string;
        includeConfig?: boolean;
      }) => {
        try {
          const report = await runPurge({
            configPath: options.config,
            env: Bun.env,
            flags: flagsFromOptions(options),
            includeConfig: options.includeConfig ?? false,
          });

          console.log(
            `Purged Slopwatch-owned indexed data from ${report.indexedData.tables.length} tables.`,
          );

          if (report.config.removed) {
            console.log(`Removed config at ${report.config.path}.`);
          }
        } catch (error) {
          console.error(formatCliError(error));
          process.exitCode = 1;
        }
      },
    );

  return program;
}

async function resolveCommandConfig(options: {
  config?: string;
  databaseUrl?: string;
  source?: string[];
}): Promise<RuntimeConfig> {
  const userConfig = await readUserConfig(
    options.config ?? defaultUserConfigPath(),
  );

  if (userConfig.status === "malformed") {
    throw new Error(userConfig.message);
  }

  return resolveRuntimeConfig({
    userConfig: userConfig.config,
    env: Bun.env,
    flags: flagsFromOptions(options),
  });
}

function flagsFromOptions(options: {
  databaseUrl?: string;
  source?: string[];
}): RuntimeConfigFlags {
  return {
    databaseUrl: options.databaseUrl,
    sources: sourceFlags(options.source),
  };
}

function sourceFlags(paths: string[] | undefined): SourceConfig[] | undefined {
  if (!paths || paths.length === 0) {
    return undefined;
  }

  return paths.map((path, index) => ({
    sourceKey: index === 0 ? "codex-local:default" : `codex-local:${path}`,
    sourceType: "codex-local",
    path,
  }));
}

function collectValue(value: string, previous: string[]) {
  previous.push(value);
  return previous;
}

function isLocalhostHost(host: string) {
  const normalizedHost = host.trim().toLowerCase();

  return (
    normalizedHost === "127.0.0.1" ||
    normalizedHost === "localhost" ||
    normalizedHost === "::1" ||
    normalizedHost === "[::1]"
  );
}

function formatNetworkExposureWarning(host: string) {
  return `Warning: binding Slopwatch to ${host} exposes the unauthenticated dashboard and API beyond localhost.`;
}

function formatOpenDashboardWarning(url: string, error: unknown) {
  return `Warning: unable to open ${url} in a browser: ${formatCliError(error)}`;
}

export async function openDashboardUrl(url: string) {
  const proc = Bun.spawn(openDashboardCommand(url), {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Unable to open dashboard URL in a browser: ${url}`);
  }
}

function openDashboardCommand(url: string) {
  if (process.platform === "darwin") {
    return ["open", url];
  }

  if (process.platform === "win32") {
    return ["cmd", "/c", "start", "", url];
  }

  return ["xdg-open", url];
}

function printInitReport(report: Awaited<ReturnType<typeof runInit>>) {
  console.log(
    `Config ${report.config.created ? "created" : "ready"} at ${report.config.path}.`,
  );
  console.log(`Database: ${report.database.status}`);
  console.log(`Migration: ${report.migration.status}`);
}

function printDoctorReport(report: Awaited<ReturnType<typeof runDoctor>>) {
  console.log(
    `Runtime: ${report.runtime.status} (Bun ${report.runtime.bunVersion})`,
  );
  console.log(`Config: ${report.config.status} (${report.config.path})`);
  console.log(`Database: ${report.database.status}`);
  console.log(`Migration: ${report.migration.status}`);
  console.log(`Permissions: ${report.permissions.status}`);
  console.log(`Sources: ${report.sources.length}`);
  console.log(`Source format: ${report.sourceFormat.status}`);

  for (const source of report.sources) {
    console.log(formatSourceLine(source));
  }
}

function printSources(sources: Awaited<ReturnType<typeof listSources>>) {
  if (sources.length === 0) {
    console.log("No Sources found.");
    return;
  }

  for (const source of sources) {
    console.log(formatSourceLine(source));
  }
}

function formatSourceLine(
  source: Awaited<ReturnType<typeof listSources>>[number],
) {
  const origin = `${source.origin}${source.overridden ? " override" : ""}`;

  return [
    source.sourceKey,
    source.sourceType,
    origin,
    source.health.status,
    source.format.status,
    source.path,
  ].join("\t");
}

function formatCliError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

if (import.meta.main) {
  await buildProgram().parseAsync();
}
