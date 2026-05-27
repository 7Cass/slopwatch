import type { SerializedNowProjection } from "./App";

export type EventSourceLike = {
  addEventListener: (
    type: string,
    listener: (event: { data: string }) => void,
  ) => void;
  close: () => void;
};

export type EventSourceFactory = (url: string) => EventSourceLike;

export function connectToNowEvents({
  eventSourceFactory = (url) => new EventSource(url),
  onProjection,
}: {
  eventSourceFactory?: EventSourceFactory;
  onProjection: (projection: SerializedNowProjection) => void;
}) {
  const source = eventSourceFactory("/api/now/events");

  source.addEventListener("now", (event) => {
    onProjection(JSON.parse(event.data) as SerializedNowProjection);
  });

  return () => {
    source.close();
  };
}
