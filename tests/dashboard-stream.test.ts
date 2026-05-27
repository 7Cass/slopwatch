import { expect, test } from "bun:test";

import {
  connectToNowEvents,
  type EventSourceLike,
} from "../src/dashboard/now-stream";
import type { SerializedNowProjection } from "../src/dashboard/App";

class FakeEventSource implements EventSourceLike {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

test("Now stream connector publishes SSE snapshots and closes the source", () => {
  FakeEventSource.instances = [];
  const snapshots: SerializedNowProjection[] = [];
  const projection: SerializedNowProjection = {
    generatedAt: "2026-05-01T10:10:00.000Z",
    groups: [],
  };

  const disconnect = connectToNowEvents({
    eventSourceFactory: (url) => new FakeEventSource(url),
    onProjection: (snapshot) => {
      snapshots.push(snapshot);
    },
  });

  const [source] = FakeEventSource.instances;

  expect(source?.url).toBe("/api/now/events");

  source?.emit("now", projection);
  disconnect();

  expect(snapshots).toEqual([projection]);
  expect(source?.closed).toBe(true);
});
