import { afterEach, describe, expect, test } from "bun:test";

import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { readCodexLocalSourceRecords } from "../src/collect/codex-local";

let tmpRoots: string[] = [];

async function tempCodexSource() {
  const root = await mkdtemp(join(tmpdir(), "slopwatch-codex-source-"));
  tmpRoots.push(root);

  return root;
}

afterEach(async () => {
  const roots = tmpRoots;
  tmpRoots = [];

  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function writeSanitizedCodexSource({
  extraRolloutRecords = [],
  threadId = "thread-main",
  parentThreadId,
}: {
  extraRolloutRecords?: unknown[];
  threadId?: string;
  parentThreadId?: string;
} = {}) {
  const sourcePath = await tempCodexSource();
  const rolloutRelativePath =
    "sessions/2026/05/27/rollout-2026-05-27T10-00-00-thread-main.jsonl";
  const rolloutPath = join(sourcePath, rolloutRelativePath);

  await mkdir(join(sourcePath, "sessions", "2026", "05", "27"), {
    recursive: true,
  });
  await writeFile(
    join(sourcePath, "version.json"),
    `${JSON.stringify({
      latest_version: "0.134.0",
      last_checked_at: "2026-05-27T03:23:22.037570Z",
    })}\n`,
    "utf8",
  );

  const database = new Database(join(sourcePath, "state_5.sqlite"));
  database.run(`
    create table threads (
      id text primary key,
      rollout_path text not null,
      created_at integer not null,
      updated_at integer not null,
      source text not null,
      model_provider text not null,
      cwd text not null,
      title text not null,
      sandbox_policy text not null,
      approval_mode text not null,
      cli_version text not null default '',
      git_sha text,
      git_branch text,
      git_origin_url text,
      model text,
      thread_source text,
      created_at_ms integer,
      updated_at_ms integer
    );
  `);
  database.run(`
    create table thread_spawn_edges (
      parent_thread_id text not null,
      child_thread_id text not null primary key,
      status text not null
    );
  `);
  database
    .query(
      `
        insert into threads (
          id,
          rollout_path,
          created_at,
          updated_at,
          source,
          model_provider,
          cwd,
          title,
          sandbox_policy,
          approval_mode,
          cli_version,
          git_sha,
          git_branch,
          git_origin_url,
          model,
          thread_source,
          created_at_ms,
          updated_at_ms
        ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .run(
    threadId,
      rolloutPath,
      1779876000,
      1779876120,
      "cli",
      "openai",
      "/projects/slopwatch-demo",
      "Sanitized collection run",
      "workspace-write",
      "on-request",
      "0.134.0",
      "abc123",
      "main",
      "https://github.com/7Cass/slopwatch.git",
      "gpt-5-codex",
      "user",
      1779876000000,
      1779876120000,
  );
  if (parentThreadId) {
    database
      .query(
        `
          insert into thread_spawn_edges (
            parent_thread_id,
            child_thread_id,
            status
          ) values (?, ?, ?)
        `,
      )
      .run(parentThreadId, threadId, "running");
  }
  database.close();

  await writeFile(
    rolloutPath,
    [
      {
        timestamp: "2026-05-27T10:00:00.000Z",
        type: "session_meta",
        payload: {
          id: threadId,
          timestamp: "2026-05-27T10:00:00.000Z",
          cwd: "/projects/slopwatch-demo",
          cli_version: "0.134.0",
          source: "cli",
          thread_source: "user",
          model_provider: "openai",
        },
      },
      {
        timestamp: "2026-05-27T10:01:00.000Z",
        type: "event_msg",
        payload: {
          type: "task_started",
          turn_id: "turn-1",
          started_at: "2026-05-27T10:01:00.000Z",
        },
      },
      {
        timestamp: "2026-05-27T10:02:00.000Z",
        type: "response_item",
        payload: {
          type: "function_call",
          name: "exec_command",
          call_id: "call-1",
          arguments: "{\"cmd\":\"bun test\"}",
        },
      },
      ...extraRolloutRecords,
    ]
      .map((record) => JSON.stringify(record))
      .join("\n") + "\n",
    "utf8",
  );

  return { sourcePath, rolloutRelativePath };
}

describe("Codex local Source adapter", () => {
  test("normalizes sanitized real-format rollout records with stable Source locators and identity", async () => {
    const { sourcePath, rolloutRelativePath } =
      await writeSanitizedCodexSource();

    const records = await readCodexLocalSourceRecords({
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: sourcePath,
      },
    });

    expect(records).toHaveLength(3);
    expect(records.map((record) => record.event.sourceLocator)).toEqual([
      `${rolloutRelativePath}:1`,
      `${rolloutRelativePath}:2`,
      `${rolloutRelativePath}:3`,
    ]);
    expect(records.map((record) => record.event.eventType)).toEqual([
      "session_started",
      "task_started",
      "tool_call",
    ]);

    const [firstRecord, _secondRecord, thirdRecord] = records;

    expect(firstRecord).toMatchObject({
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: sourcePath,
        healthStatus: "ok",
      },
      project: {
        projectKey: "local:/projects/slopwatch-demo",
        rootPath: "/projects/slopwatch-demo",
        displayName: "slopwatch-demo",
      },
      session: {
        sourceSessionId: "thread-main",
        startedAt: new Date("2026-05-27T10:00:00.000Z"),
        lastObservedAt: new Date("2026-05-27T10:02:00.000Z"),
      },
      fork: {
        sourceForkId: "thread-main",
        originForkId: null,
        startedAt: new Date("2026-05-27T10:00:00.000Z"),
        lastObservedAt: new Date("2026-05-27T10:02:00.000Z"),
      },
      workUnit: {
        identityKey: "codex-local:default:thread-main",
        firstObservedAt: new Date("2026-05-27T10:00:00.000Z"),
        lastObservedAt: new Date("2026-05-27T10:02:00.000Z"),
      },
      event: {
        sourceVersion: "0.134.0",
        parserVersion: "codex-local-v0",
      },
    });
    expect(firstRecord?.event.metadata).toEqual({
      action: "started session",
      cwd: "/projects/slopwatch-demo",
      source: "cli",
      threadSource: "user",
      modelProvider: "openai",
      model: "gpt-5-codex",
      gitBranch: "main",
      gitSha: "abc123",
      gitOriginUrl: "https://github.com/7Cass/slopwatch.git",
    });
    expect(firstRecord?.event.rawPayload).toBeNull();
    expect(thirdRecord?.event.metadata).toEqual({
      action: "called tool",
      toolName: "exec_command",
      callId: "call-1",
      command: "bun test",
      toolCalls: 1,
    });
  });

  test("emits user and assistant message text as opt-in Raw payload instead of metadata", async () => {
    const { sourcePath } = await writeSanitizedCodexSource({
      extraRolloutRecords: [
        {
          timestamp: "2026-05-27T10:03:00.000Z",
          type: "event_msg",
          payload: {
            type: "user_message",
            message: "Please inspect this private request.",
          },
        },
        {
          timestamp: "2026-05-27T10:04:00.000Z",
          type: "event_msg",
          payload: {
            type: "agent_message",
            message: "Here is a private answer.",
            phase: "final",
          },
        },
      ],
    });

    const records = await readCodexLocalSourceRecords({
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: sourcePath,
      },
    });
    const userMessage = records.find(
      (record) => record.event.eventType === "user_message",
    );
    const assistantMessage = records.find(
      (record) => record.event.eventType === "assistant_message",
    );

    expect(userMessage?.event.metadata).toEqual({
      action: "received user message",
    });
    expect(userMessage?.event.rawPayload).toBe(
      "Please inspect this private request.",
    );
    expect(userMessage?.event.rawPayloadKind).toBe("source_text");

    expect(assistantMessage?.event.metadata).toEqual({
      action: "sent assistant message",
      phase: "final",
    });
    expect(assistantMessage?.event.rawPayload).toBe(
      "Here is a private answer.",
    );
    expect(assistantMessage?.event.rawPayloadKind).toBe("source_text");
  });

  test("normalizes response item messages from content parts as Raw payload", async () => {
    const { sourcePath } = await writeSanitizedCodexSource({
      extraRolloutRecords: [
        {
          timestamp: "2026-05-27T10:03:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text: "Private request from content parts.",
              },
            ],
          },
        },
        {
          timestamp: "2026-05-27T10:04:00.000Z",
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: "Private answer from content parts.",
              },
            ],
          },
        },
      ],
    });

    const records = await readCodexLocalSourceRecords({
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: sourcePath,
      },
    });
    const userMessage = records.find(
      (record) =>
        record.event.eventType === "user_message" &&
        record.event.sourceLocator.endsWith(":4"),
    );
    const assistantMessage = records.find(
      (record) =>
        record.event.eventType === "assistant_message" &&
        record.event.sourceLocator.endsWith(":5"),
    );

    expect(userMessage?.event.metadata).toEqual({
      action: "received user message",
      contentParts: 1,
    });
    expect(userMessage?.event.rawPayload).toBe(
      "Private request from content parts.",
    );
    expect(userMessage?.event.rawPayloadKind).toBe("source_text");

    expect(assistantMessage?.event.metadata).toEqual({
      action: "sent assistant message",
      contentParts: 1,
    });
    expect(assistantMessage?.event.rawPayload).toBe(
      "Private answer from content parts.",
    );
    expect(assistantMessage?.event.rawPayloadKind).toBe("source_text");
  });

  test("normalizes tool outputs and token counts without storing output text in metadata", async () => {
    const { sourcePath } = await writeSanitizedCodexSource({
      extraRolloutRecords: [
        {
          timestamp: "2026-05-27T10:03:00.000Z",
          type: "response_item",
          payload: {
            type: "function_call_output",
            call_id: "call-1",
            output: "Private command output.",
          },
        },
        {
          timestamp: "2026-05-27T10:04:00.000Z",
          type: "event_msg",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 20,
                output_tokens: 30,
                reasoning_output_tokens: 10,
                total_tokens: 130,
              },
              model_context_window: 258400,
            },
          },
        },
      ],
    });

    const records = await readCodexLocalSourceRecords({
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: sourcePath,
      },
    });
    const toolResult = records.find(
      (record) => record.event.eventType === "tool_result",
    );
    const tokenCount = records.find(
      (record) => record.event.eventType === "token_count",
    );

    expect(toolResult?.event.metadata).toEqual({
      action: "reported tool result",
      callId: "call-1",
    });
    expect(toolResult?.event.rawPayload).toBe("Private command output.");
    expect(toolResult?.event.rawPayloadKind).toBe("source_text");

    expect(tokenCount?.event.metadata).toEqual({
      action: "reported token count",
      inputTokens: 100,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningOutputTokens: 10,
      totalTokens: 130,
      modelContextWindow: 258400,
      tokenQuality: "reported",
    });
    expect(tokenCount?.event.rawPayload).toBeNull();
  });

  test("preserves Codex parent thread metadata as Fork origin identity", async () => {
    const { sourcePath } = await writeSanitizedCodexSource({
      threadId: "019e6aaa-0000-7000-8000-000000000002",
      parentThreadId: "019e6aaa-0000-7000-8000-000000000001",
    });

    const records = await readCodexLocalSourceRecords({
      source: {
        sourceKey: "codex-local:default",
        sourceType: "codex-local",
        path: sourcePath,
      },
    });

    expect(records[0]?.fork).toMatchObject({
      sourceForkId: "019e6aaa-0000-7000-8000-000000000002",
      originForkId: "019e6aaa-0000-7000-8000-000000000001",
    });
  });
});
