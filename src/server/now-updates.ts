export type NowUpdateListener = () => void | Promise<void>;

export type NowUpdateSource = {
  subscribe: (listener: NowUpdateListener) => () => void;
};

export type NowUpdateBus = NowUpdateSource & {
  publish: () => void;
  close: () => void;
};

export function createNowUpdateBus({
  coalesceMs = 250,
}: {
  coalesceMs?: number;
} = {}): NowUpdateBus {
  const listeners = new Set<NowUpdateListener>();
  let pendingUpdate: ReturnType<typeof setTimeout> | undefined;
  let closed = false;

  return {
    subscribe: (listener) => {
      if (closed) {
        return () => {};
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    publish: () => {
      if (closed || pendingUpdate) {
        return;
      }

      pendingUpdate = setTimeout(() => {
        pendingUpdate = undefined;

        for (const listener of [...listeners]) {
          void listener();
        }
      }, coalesceMs);
    },
    close: () => {
      closed = true;
      listeners.clear();

      if (pendingUpdate) {
        clearTimeout(pendingUpdate);
        pendingUpdate = undefined;
      }
    },
  };
}
