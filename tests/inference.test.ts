import { describe, expect, test } from "bun:test";

import {
  inferWorkUnit,
  runWorkUnitInference,
  type InferenceEvent,
  type InferenceStore,
  type WorkUnitInference,
} from "../src/infer/work-unit";

class InMemoryInferenceStore implements InferenceStore {
  inference?: WorkUnitInference;

  constructor(private events: InferenceEvent[]) {}

  async listWorkUnitEvents() {
    return this.events;
  }

  async upsertInference(inference: WorkUnitInference) {
    this.inference = inference;
    return inference;
  }

  appendEvent(event: InferenceEvent) {
    this.events.push(event);
  }
}

describe("WorkUnit inference", () => {
  test("infers Active from recent Events when no stronger state applies", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "reported progress",
          },
        },
      ],
    });

    expect(inference).toMatchObject({
      workUnitId: "work-unit-1",
      state: "active",
      inferenceVersion: "work-unit-inference-v1",
      activeTimeMs: 0,
    });
    expect(inference.confidence).toBeGreaterThan(0);
    expect(inference.calculatedAt.toISOString()).toBe(
      "2026-05-01T10:10:00.000Z",
    );
    expect(inference.explanation).toContain("recent activity");
  });

  test("infers Blocked from explicit waiting evidence", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "waiting for user input",
            waitingFor: "user_input",
          },
        },
      ],
    });

    expect(inference.state).toBe("blocked");
    expect(inference.confidence).toBeGreaterThan(0.8);
    expect(inference.explanation).toContain("waiting for user input");
  });

  test("infers Blocked from the latest relevant waiting Event", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "waiting for approval",
            waitingFor: "approval",
          },
        },
        {
          eventType: "token_count",
          observedAt: new Date("2026-05-01T10:05:00.000Z"),
          metadata: {
            action: "reported token count",
            totalTokens: 120,
            tokenQuality: "reported",
          },
        },
      ],
    });

    expect(inference.state).toBe("blocked");
    expect(inference.explanation).toContain("waiting for approval");
  });

  test("does not infer Blocked from stale waiting evidence after later activity", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "waiting for approval",
            waitingFor: "approval",
          },
        },
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T10:05:00.000Z"),
          metadata: {
            action: "called tool",
            command: "bun test",
          },
        },
      ],
    });

    expect(inference.state).toBe("active");
    expect(inference.explanation).toContain("recent activity");
  });

  test("keeps a failed command as an Event when later activity continues", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T10:02:00.000Z"),
          metadata: {
            action: "ran command",
            command: "bun test",
            exitCode: 1,
          },
        },
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "reported progress",
          },
        },
      ],
    });

    expect(inference.state).toBe("active");
    expect(inference.explanation).toContain("later activity");
  });

  test("does not infer Failed from a failed test command without terminal evidence", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "ran command",
            command: "bun test",
            exitCode: 1,
          },
        },
      ],
    });

    expect(inference.state).toBe("active");
    expect(inference.explanation).toContain("recent activity");
  });

  test("infers Failed when terminal failure evidence is final", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:02:00.000Z"),
          metadata: {
            action: "reported progress",
          },
        },
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "ran command",
            command: "bun run check",
            status: "failed",
            terminal: true,
          },
        },
      ],
    });

    expect(inference.state).toBe("failed");
    expect(inference.confidence).toBeGreaterThan(0.8);
    expect(inference.explanation).toContain("terminal failure");
  });

  test("infers Failed when a final relevant error has no continuation", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:02:00.000Z"),
          metadata: {
            action: "reported progress",
          },
        },
        {
          eventType: "error",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            message: "Unhandled exception",
          },
        },
      ],
    });

    expect(inference.state).toBe("failed");
    expect(inference.explanation).toContain("terminal failure");
  });

  test("infers Finished from explicit completion evidence", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "finished work",
            status: "finished",
            terminal: true,
          },
        },
      ],
    });

    expect(inference.state).toBe("finished");
    expect(inference.confidence).toBeGreaterThan(0.8);
    expect(inference.explanation).toContain("completion evidence");
  });

  test("recalculates a Finished WorkUnit back to Active when later Events arrive", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "finished work",
            status: "finished",
          },
        },
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T10:06:00.000Z"),
          metadata: {
            action: "ran command",
            command: "bun test",
          },
        },
      ],
    });

    expect(inference.state).toBe("active");
    expect(inference.explanation).toContain("later activity");
  });

  test("does not infer Blocked from inactivity alone", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T12:00:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: {
            action: "reported progress",
          },
        },
      ],
    });

    expect(inference.state).not.toBe("blocked");
    expect(inference.explanation).not.toContain("waiting");
  });

  test("estimates active time from Activity Windows instead of raw Session duration", () => {
    const inference = inferWorkUnit({
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T11:10:00.000Z"),
      events: [
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T10:00:00.000Z"),
          metadata: { action: "started" },
        },
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T10:04:00.000Z"),
          metadata: { action: "ran command" },
        },
        {
          eventType: "assistant_message",
          observedAt: new Date("2026-05-01T11:00:00.000Z"),
          metadata: { action: "continued after idle gap" },
        },
        {
          eventType: "tool_call",
          observedAt: new Date("2026-05-01T11:02:00.000Z"),
          metadata: { action: "ran command" },
        },
      ],
    });

    expect(inference.activeTimeMs).toBe(6 * 60 * 1000);
  });

  test("records recalculated Inference when new Events arrive", async () => {
    const store = new InMemoryInferenceStore([
      {
        eventType: "assistant_message",
        observedAt: new Date("2026-05-01T10:04:00.000Z"),
        metadata: {
          action: "finished work",
          status: "finished",
        },
      },
    ]);

    await runWorkUnitInference({
      store,
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:05:00.000Z"),
    });
    expect(store.inference?.state).toBe("finished");

    store.appendEvent({
      eventType: "tool_call",
      observedAt: new Date("2026-05-01T10:06:00.000Z"),
      metadata: {
        action: "ran command",
        command: "bun test",
      },
    });

    await runWorkUnitInference({
      store,
      workUnitId: "work-unit-1",
      calculatedAt: new Date("2026-05-01T10:07:00.000Z"),
    });

    expect(store.inference).toMatchObject({
      workUnitId: "work-unit-1",
      state: "active",
      inferenceVersion: "work-unit-inference-v1",
    });
    expect(store.inference?.calculatedAt.toISOString()).toBe(
      "2026-05-01T10:07:00.000Z",
    );
  });
});
