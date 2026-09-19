import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../src/api/client";
import {
  consumeNotificationSse,
  createNotificationStreamSupervisor,
  restartNotificationStreamsOnPersistedPageShow,
  stopNotificationStreamOnPageHide,
} from "../src/features/notifications/notificationStreamLifecycle";

describe("notification stream lifecycle", () => {
  it("serializes an immediate same-channel replacement and cancels the old reader", async () => {
    const supervisor = createNotificationStreamSupervisor();
    let activeReaders = 0;
    let maximumActiveReaders = 0;
    let opened = 0;
    let cancelled = 0;

    const open = async () => {
      opened += 1;
      activeReaders += 1;
      maximumActiveReaders = Math.max(maximumActiveReaders, activeReaders);
      return heldResponse(() => {
        cancelled += 1;
        activeReaders -= 1;
      });
    };

    const first = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open,
      onItem: () => undefined,
    });
    await waitUntil(() => opened === 1);

    first.stop();
    const second = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open,
      onItem: () => undefined,
    });

    await first.settled;
    await waitUntil(() => opened === 2);
    expect(maximumActiveReaders).toBe(1);
    expect(cancelled).toBe(1);

    first.stop();
    expect(activeReaders).toBe(1);
    second.stop();
    await second.settled;
    expect(cancelled).toBe(2);
    expect(activeReaders).toBe(0);
  });

  it("replaces a workspace or actor boundary without stopping the other channel", async () => {
    const supervisor = createNotificationStreamSupervisor();
    const active = { history: 0, broadcasts: 0 };
    const maximum = { history: 0, broadcasts: 0 };
    const opens = { history: 0, broadcasts: 0 };
    const open = (channel: "history" | "broadcasts") => async () => {
      opens[channel] += 1;
      active[channel] += 1;
      maximum[channel] = Math.max(maximum[channel], active[channel]);
      return heldResponse(() => {
        active[channel] -= 1;
      });
    };

    const historyA = supervisor.start({
      channel: "history",
      boundaryKey: "workspace-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open: open("history"),
      onItem: () => undefined,
    });
    const broadcastsA = supervisor.start({
      channel: "broadcasts",
      boundaryKey: "workspace-a",
      path: "/api/notifications/broadcasts/stream",
      sequence: { current: 0 },
      open: open("broadcasts"),
      onItem: () => undefined,
    });
    await waitUntil(() => opens.history === 1 && opens.broadcasts === 1);
    expect(active).toEqual({ history: 1, broadcasts: 1 });

    const historyB = supervisor.start({
      channel: "history",
      boundaryKey: "workspace-b",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open: open("history"),
      onItem: () => undefined,
    });
    await historyA.settled;
    await waitUntil(() => opens.history === 2);

    expect(maximum).toEqual({ history: 1, broadcasts: 1 });
    expect(active).toEqual({ history: 1, broadcasts: 1 });

    historyB.stop();
    broadcastsA.stop();
    await Promise.all([historyB.settled, broadcastsA.settled]);
    expect(active).toEqual({ history: 0, broadcasts: 0 });
  });

  it("cancels after response headers and fences a deliberately late event", async () => {
    const pendingRead: {
      resolve?: (result: ReadableStreamReadResult<Uint8Array>) => void;
    } = {};
    const reader = {
      read: vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>((resolve) => {
        pendingRead.resolve = resolve;
      })),
      cancel: vi.fn(async () => undefined),
      releaseLock: vi.fn(),
    };
    const response = {
      body: { getReader: () => reader },
    } as unknown as Response;
    const controller = new AbortController();
    const sequence = { current: 0 };
    const received: Array<{ streamSequence: number }> = [];

    const consuming = consumeNotificationSse(
      response,
      sequence,
      controller.signal,
      () => !controller.signal.aborted,
      (item: { streamSequence: number }) => received.push(item),
    );
    controller.abort();
    pendingRead.resolve?.({
      done: false,
      value: new TextEncoder().encode('data: {"streamSequence":7}\n\n'),
    });
    await consuming;

    expect(reader.cancel).toHaveBeenCalledTimes(1);
    expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    expect(sequence.current).toBe(0);
    expect(received).toEqual([]);
  });

  it("stops an active reader on pagehide and does not retry after the stop", async () => {
    const supervisor = createNotificationStreamSupervisor();
    const page = new EventTarget();
    let opened = 0;
    let cancelled = 0;
    const observedRequest: { signal?: AbortSignal } = {};
    const lease = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open: async (_path, signal) => {
        opened += 1;
        observedRequest.signal = signal;
        return heldResponse(() => {
          cancelled += 1;
        });
      },
      onItem: () => undefined,
    });
    const detach = stopNotificationStreamOnPageHide(page, lease.stop);
    await waitUntil(() => opened === 1);

    page.dispatchEvent(new Event("pagehide"));
    await lease.settled;
    await Promise.resolve();

    expect(observedRequest.signal?.aborted).toBe(true);
    expect(cancelled).toBe(1);
    expect(opened).toBe(1);
    detach();
  });

  it("restarts only for a persisted pageshow", () => {
    const page = new EventTarget();
    const restart = vi.fn();
    const detach = restartNotificationStreamsOnPersistedPageShow(page, restart);

    page.dispatchEvent(pageTransitionEvent("pageshow", false));
    page.dispatchEvent(pageTransitionEvent("pageshow", true));

    expect(restart).toHaveBeenCalledTimes(1);
    detach();
    page.dispatchEvent(pageTransitionEvent("pageshow", true));
    expect(restart).toHaveBeenCalledTimes(1);
  });

  it("does not retry a terminal response", async () => {
    const supervisor = createNotificationStreamSupervisor();
    const open = vi.fn(async () => {
      throw new ApiError("Forbidden", 403);
    });
    const lease = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open,
      onItem: () => undefined,
    });

    await lease.settled;
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("cannot reopen after stopping during recoverable backoff", async () => {
    const supervisor = createNotificationStreamSupervisor();
    const open = vi.fn(async () => {
      throw new ApiError("Unavailable", 503);
    });
    const lease = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open,
      onItem: () => undefined,
    });
    await waitUntil(() => open.mock.calls.length === 1);

    lease.stop();
    await lease.settled;
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("fails closed until a predecessor with pending cancellation settles", async () => {
    const supervisor = createNotificationStreamSupervisor();
    const cancellation = deferred<void>();
    const firstRead = deferred<ReadableStreamReadResult<Uint8Array>>();
    let firstOpened = 0;
    let secondOpened = 0;
    const first = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open: async () => {
        firstOpened += 1;
        return responseWithReader({
          read: () => firstRead.promise,
          cancel: () => cancellation.promise.then(() => {
            firstRead.resolve({ done: true, value: undefined });
          }),
        });
      },
      onItem: () => undefined,
    });
    await waitUntil(() => firstOpened === 1);

    const second = supervisor.start({
      channel: "history",
      boundaryKey: "actor-b",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open: async () => {
        secondOpened += 1;
        return heldResponse(() => undefined);
      },
      onItem: () => undefined,
    });
    await flushMicrotasks();

    expect(secondOpened).toBe(0);
    cancellation.resolve();
    await first.settled;
    await waitUntil(() => secondOpened === 1);
    second.stop();
    await second.settled;
  });

  it("cancels a response whose headers arrive after its lease was stopped", async () => {
    const supervisor = createNotificationStreamSupervisor();
    const lateResponse = deferred<Response>();
    let cancelled = 0;
    const received = vi.fn();
    const lease = supervisor.start({
      channel: "history",
      boundaryKey: "actor-a",
      path: "/api/notifications/history/stream",
      sequence: { current: 0 },
      open: () => lateResponse.promise,
      onItem: received,
    });
    await flushMicrotasks();

    lease.stop();
    lateResponse.resolve(heldResponse(() => {
      cancelled += 1;
    }));
    await lease.settled;

    expect(cancelled).toBe(1);
    expect(received).not.toHaveBeenCalled();
  });
});

function heldResponse(onCancel: () => void): Response {
  return new Response(new ReadableStream<Uint8Array>({
    cancel() {
      onCancel();
    },
  }), {
    headers: { "Content-Type": "text/event-stream" },
  });
}

function pageTransitionEvent(type: string, persisted: boolean): Event {
  const event = new Event(type);
  Object.defineProperty(event, "persisted", { value: persisted });
  return event;
}

function responseWithReader(reader: {
  read: () => Promise<ReadableStreamReadResult<Uint8Array>>;
  cancel: () => Promise<void>;
}): Response {
  return {
    body: {
      getReader: () => ({
        ...reader,
        releaseLock: () => undefined,
      }),
    },
  } as unknown as Response;
}

function deferred<T>() {
  let resolvePromise: (value: T | PromiseLike<T>) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

async function flushMicrotasks() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for notification stream test state.");
}
