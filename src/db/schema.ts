import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

export const sources = pgTable("slopwatch_sources", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceKey: text("source_key").notNull().unique(),
  sourceType: text("source_type").notNull(),
  path: text("path"),
  healthStatus: text("health_status").notNull().default("unknown"),
  ...timestamps,
});

export const projects = pgTable("slopwatch_projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectKey: text("project_key").notNull().unique(),
  rootPath: text("root_path").notNull(),
  displayName: text("display_name").notNull(),
  ...timestamps,
});

export const sessions = pgTable(
  "slopwatch_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sourceSessionId: text("source_session_id").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    sourceSession: uniqueIndex("slopwatch_sessions_source_session_idx").on(
      table.sourceId,
      table.sourceSessionId,
    ),
  }),
);

export const forks = pgTable(
  "slopwatch_forks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    sourceForkId: text("source_fork_id").notNull(),
    sourceOriginForkId: text("source_origin_fork_id"),
    originForkId: uuid("origin_fork_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    sourceFork: uniqueIndex("slopwatch_forks_source_fork_idx").on(
      table.sessionId,
      table.sourceForkId,
    ),
    sourceOrigin: index("slopwatch_forks_source_origin_idx")
      .on(table.sourceOriginForkId)
      .where(sql`${table.sourceOriginForkId} IS NOT NULL`),
  }),
);

export const workUnits = pgTable(
  "slopwatch_work_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    forkId: uuid("fork_id").references(() => forks.id),
    identityKey: text("identity_key").notNull().unique(),
    firstObservedAt: timestamp("first_observed_at", { withTimezone: true }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => ({
    projectLastObserved: index("slopwatch_work_units_project_last_idx").on(
      table.projectId,
      table.lastObservedAt,
    ),
  }),
);

export const events = pgTable(
  "slopwatch_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    sessionId: uuid("session_id")
      .notNull()
      .references(() => sessions.id),
    forkId: uuid("fork_id").references(() => forks.id),
    workUnitId: uuid("work_unit_id")
      .notNull()
      .references(() => workUnits.id),
    sourceLocator: text("source_locator").notNull(),
    eventType: text("event_type").notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    rawPayload: text("raw_payload"),
    parserVersion: text("parser_version").notNull(),
    sourceVersion: text("source_version"),
    ...timestamps,
  },
  (table) => ({
    sourceLocator: uniqueIndex("slopwatch_events_source_locator_idx").on(
      table.sourceId,
      table.sourceLocator,
    ),
    workUnitObserved: index("slopwatch_events_work_unit_observed_idx").on(
      table.workUnitId,
      table.observedAt,
    ),
  }),
);

export const inferences = pgTable("slopwatch_inferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  workUnitId: uuid("work_unit_id")
    .notNull()
    .unique()
    .references(() => workUnits.id),
  state: text("state").notNull(),
  confidence: real("confidence").notNull(),
  explanation: text("explanation").notNull(),
  activeTimeMs: integer("active_time_ms").notNull().default(0),
  inferenceVersion: text("inference_version").notNull(),
  calculatedAt: timestamp("calculated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  ...timestamps,
});
