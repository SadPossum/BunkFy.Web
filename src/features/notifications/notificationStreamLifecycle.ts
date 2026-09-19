import { ApiError } from "../../api/client";
import { notificationStreamRetryDelay } from "./notificationSourceAuthority";

export type NotificationStreamChannel = "history" | "broadcasts";
export type NotificationSequence = { current: number };
export type NotificationStreamOpen = (
  path: string,
  signal: AbortSignal,
) => Promise<Response>;

export type NotificationStreamLease = {
  stop: () => void;
  readonly settled: Promise<void>;
};

type NotificationStreamOptions<T extends { streamSequence?: number }> = {
  channel: NotificationStreamChannel;
  boundaryKey: string;
  path: string;
  sequence: NotificationSequence;
  open: NotificationStreamOpen;
  onItem: (item: T) => void;
};

type NotificationStreamOwner = {
  boundaryKey: string;
  controller: AbortController;
  id: symbol;
  settled: Promise<void>;
  stop: () => void;
};

export function createNotificationStreamSupervisor() {
  const owners = new Map<NotificationStreamChannel, NotificationStreamOwner>();

  return {
    start<T extends { streamSequence?: number }>(
      options: NotificationStreamOptions<T>,
    ): NotificationStreamLease {
      const predecessor = owners.get(options.channel);
      predecessor?.stop();

      const controller = new AbortController();
      const id = Symbol(`${options.channel}:${options.boundaryKey}`);
      const stop = () => {
        if (!controller.signal.aborted) controller.abort();
      };
      const isCurrent = () => {
        const owner = owners.get(options.channel);
        return !controller.signal.aborted &&
          owner?.id === id &&
          owner.boundaryKey === options.boundaryKey;
      };

      const settled = (async () => {
        await predecessor?.settled.catch(() => undefined);
        if (!isCurrent()) return;
        await keepNotificationStream(options, controller.signal, isCurrent);
      })().finally(() => {
        if (owners.get(options.channel)?.id === id) owners.delete(options.channel);
      });

      owners.set(options.channel, {
        boundaryKey: options.boundaryKey,
        controller,
        id,
        settled,
        stop,
      });

      return { stop, settled };
    },
  };
}

export const notificationStreamSupervisor = createNotificationStreamSupervisor();

export function stopNotificationStreamOnPageHide(
  target: EventTarget,
  stop: () => void,
): () => void {
  const onPageHide = () => stop();
  target.addEventListener("pagehide", onPageHide);
  return () => target.removeEventListener("pagehide", onPageHide);
}

export function restartNotificationStreamsOnPersistedPageShow(
  target: EventTarget,
  restart: () => void,
): () => void {
  const onPageShow = (event: Event) => {
    if ("persisted" in event && event.persisted === true) restart();
  };
  target.addEventListener("pageshow", onPageShow);
  return () => target.removeEventListener("pageshow", onPageShow);
}

export function shouldRetryNotificationStream(error: unknown) {
  return !(error instanceof ApiError
    && error.status >= 400
    && error.status < 500
    && error.status !== 408
    && error.status !== 429);
}

async function keepNotificationStream<T extends { streamSequence?: number }>(
  options: NotificationStreamOptions<T>,
  signal: AbortSignal,
  isCurrent: () => boolean,
) {
  let retryAttempt = 0;
  while (isCurrent()) {
    let connectedAt: number | null = null;
    try {
      const response = await options.open(
        `${options.path}?afterSequence=${options.sequence.current}`,
        signal,
      );
      if (!isCurrent()) {
        await cancelUnlockedResponse(response);
        return;
      }
      connectedAt = Date.now();
      await consumeNotificationSse(
        response,
        options.sequence,
        signal,
        isCurrent,
        options.onItem,
      );
    } catch (error) {
      if (!isCurrent() || !shouldRetryNotificationStream(error)) return;
    }
    if (!isCurrent()) return;
    if (connectedAt !== null && Date.now() - connectedAt >= 30_000) {
      retryAttempt = 0;
    }
    await waitForNotificationRetry(
      signal,
      notificationStreamRetryDelay(retryAttempt),
    );
    retryAttempt = Math.min(5, retryAttempt + 1);
  }
}

export async function consumeNotificationSse<
  T extends { streamSequence?: number },
>(
  response: Response,
  sequence: NotificationSequence,
  signal: AbortSignal,
  isCurrent: () => boolean,
  onItem: (item: T) => void,
) {
  const reader = response.body?.getReader();
  if (!reader) return;

  let cancellation: Promise<void> | null = null;
  const cancelReader = () => {
    if (cancellation) return cancellation;
    try {
      cancellation = reader.cancel().then(
        () => undefined,
        () => undefined,
      );
    } catch {
      cancellation = Promise.resolve();
    }
    return cancellation;
  };
  const onAbort = () => {
    void cancelReader();
  };

  signal.addEventListener("abort", onAbort, { once: true });
  if (!isCurrent()) void cancelReader();

  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (isCurrent()) {
      const { done, value } = await reader.read();
      if (!isCurrent() || done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary = buffer.indexOf("\n\n");
      while (boundary >= 0 && isCurrent()) {
        const block = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = block
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data && isCurrent()) {
          try {
            const item = JSON.parse(data) as T;
            if (!isCurrent()) return;
            if (typeof item.streamSequence === "number") {
              sequence.current = Math.max(sequence.current, item.streamSequence);
            }
            if (isCurrent()) onItem(item);
          } catch {
            // Ignore malformed events and continue the current durable stream.
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } catch (error) {
    if (isCurrent()) throw error;
  } finally {
    signal.removeEventListener("abort", onAbort);
    if (!isCurrent()) await cancelReader();
    try {
      reader.releaseLock();
    } catch {
      // Cancellation can already have released or invalidated the reader lock.
    }
  }
}

async function cancelUnlockedResponse(response: Response) {
  if (!response.body || response.body.locked) return;
  try {
    await response.body.cancel();
  } catch {
    // A superseded response is already unusable; cancellation is best effort.
  }
}

function waitForNotificationRetry(signal: AbortSignal, delay: number) {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve();
    const onAbort = () => {
      globalThis.clearTimeout(timer);
      resolve();
    };
    const timer = globalThis.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
