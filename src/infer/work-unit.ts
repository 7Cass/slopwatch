export const workUnitInferenceVersion = "work-unit-inference-v1";

export type WorkUnitState = "active" | "blocked" | "failed" | "finished";

export type InferenceEvent = {
  eventType: string;
  observedAt: Date;
  metadata: Record<string, unknown>;
};

export type WorkUnitInference = {
  workUnitId: string;
  state: WorkUnitState;
  confidence: number;
  explanation: string;
  activeTimeMs: number;
  inferenceVersion: string;
  calculatedAt: Date;
};

export type InferenceStore = {
  listWorkUnitEvents: (workUnitId: string) => Promise<InferenceEvent[]>;
  upsertInference: (
    inference: WorkUnitInference,
  ) => Promise<WorkUnitInference>;
};

const defaultActivityWindowGapMs = 10 * 60 * 1000;

export async function runWorkUnitInference({
  store,
  workUnitId,
  calculatedAt = new Date(),
}: {
  store: InferenceStore;
  workUnitId: string;
  calculatedAt?: Date;
}) {
  const events = await store.listWorkUnitEvents(workUnitId);
  const inference = inferWorkUnit({ workUnitId, events, calculatedAt });

  return store.upsertInference(inference);
}

export function inferWorkUnit({
  workUnitId,
  events,
  calculatedAt = new Date(),
}: {
  workUnitId: string;
  events: InferenceEvent[];
  calculatedAt?: Date;
}): WorkUnitInference {
  const orderedEvents = [...events].sort(
    (left, right) => left.observedAt.getTime() - right.observedAt.getTime(),
  );
  const activeTimeMs = calculateActiveTimeMs(orderedEvents);
  const latestEvent = orderedEvents.at(-1);

  if (!latestEvent) {
    return {
      workUnitId,
      state: "finished",
      confidence: 0,
      explanation: "No Events are available for this WorkUnit.",
      activeTimeMs,
      inferenceVersion: workUnitInferenceVersion,
      calculatedAt,
    };
  }

  const waitingEvidence = findWaitingEvidence(latestEvent);

  if (waitingEvidence) {
    return {
      workUnitId,
      state: "blocked",
      confidence: 0.9,
      explanation: `Blocked because the latest Event shows waiting for ${waitingEvidence}.`,
      activeTimeMs,
      inferenceVersion: workUnitInferenceVersion,
      calculatedAt,
    };
  }

  const failedEvent = findLast(orderedEvents, isFailureEvent);
  const finishedEvent = findLast(orderedEvents, isFinishedEvent);

  if (isTerminalFailureEvent(latestEvent)) {
    return {
      workUnitId,
      state: "failed",
      confidence: 0.9,
      explanation: "Failed because the final Event has terminal failure evidence.",
      activeTimeMs,
      inferenceVersion: workUnitInferenceVersion,
      calculatedAt,
    };
  }

  if (isFinishedEvent(latestEvent)) {
    return {
      workUnitId,
      state: "finished",
      confidence: 0.9,
      explanation: "Finished because the final Event has completion evidence.",
      activeTimeMs,
      inferenceVersion: workUnitInferenceVersion,
      calculatedAt,
    };
  }

  return {
    workUnitId,
    state: "active",
    confidence: 0.7,
    explanation:
      failedEvent && latestEvent.observedAt > failedEvent.observedAt
        ? "Active because later activity continued after a failed Event."
        : finishedEvent && latestEvent.observedAt > finishedEvent.observedAt
          ? "Active because later activity arrived after completion evidence."
        : "Active because recent activity was observed.",
    activeTimeMs,
    inferenceVersion: workUnitInferenceVersion,
    calculatedAt,
  };
}

function findWaitingEvidence(event: InferenceEvent) {
  if (typeof event.metadata.waitingFor === "string") {
    return formatSnakeValue(event.metadata.waitingFor);
  }

  if (
    typeof event.metadata.action === "string" &&
    event.metadata.action.toLowerCase().includes("waiting for")
  ) {
    return event.metadata.action;
  }

  return null;
}

function formatSnakeValue(value: string) {
  return value.replaceAll("_", " ");
}

function findLast<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];

    if (value !== undefined && predicate(value)) {
      return value;
    }
  }

  return undefined;
}

function isFailureEvent(event: InferenceEvent) {
  return (
    (typeof event.metadata.exitCode === "number" &&
      event.metadata.exitCode !== 0) ||
    event.metadata.status === "failed" ||
    event.eventType === "error"
  );
}

function isTerminalFailureEvent(event: InferenceEvent) {
  return (
    event.eventType === "error" ||
    (event.metadata.terminal === true && isFailureEvent(event))
  );
}

function isFinishedEvent(event: InferenceEvent) {
  return (
    event.metadata.status === "finished" ||
    event.metadata.status === "completed" ||
    event.eventType === "session_finished"
  );
}

function calculateActiveTimeMs(events: InferenceEvent[]) {
  let activeTimeMs = 0;
  let windowStart: Date | undefined;
  let previousEvent: Date | undefined;

  for (const event of events) {
    if (!windowStart || !previousEvent) {
      windowStart = event.observedAt;
      previousEvent = event.observedAt;
      continue;
    }

    if (
      event.observedAt.getTime() - previousEvent.getTime() >
      defaultActivityWindowGapMs
    ) {
      activeTimeMs += previousEvent.getTime() - windowStart.getTime();
      windowStart = event.observedAt;
    }

    previousEvent = event.observedAt;
  }

  if (windowStart && previousEvent) {
    activeTimeMs += previousEvent.getTime() - windowStart.getTime();
  }

  return activeTimeMs;
}
