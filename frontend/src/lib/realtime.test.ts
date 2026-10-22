import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => void;

const fake = vi.hoisted(() => {
  const state = {
    handlers: new Map<string, Handler>(),
    emitted: [] as [string, unknown][],
    ack: undefined as undefined | ((res: { ok: boolean }) => void),
    connected: false,
    disconnected: false,
  };
  const socket = {
    on(event: string, handler: Handler) {
      state.handlers.set(event, handler);
      return socket;
    },
    emit(event: string, payload: unknown, ack?: (res: { ok: boolean }) => void) {
      state.emitted.push([event, payload]);
      state.ack = ack;
    },
    connect: vi.fn(),
    disconnect() {
      state.disconnected = true;
    },
    get connected() {
      return state.connected;
    },
  };
  return { state, socket };
});

vi.mock("socket.io-client", () => ({ io: () => fake.socket }));

import { joinRequestRoom, startRealtime, stopRealtime } from "./realtime";

const client = new QueryClient();
const invalidate = vi.spyOn(client, "invalidateQueries");
const invalidatedKeys = () => invalidate.mock.calls.map(([filters]) => (filters as { queryKey?: unknown[] } | undefined)?.queryKey?.[0]);
const emit = (event: string, payload?: unknown) => fake.state.handlers.get(event)?.(payload);

beforeEach(() => {
  stopRealtime();
  invalidate.mockClear();
  Object.assign(fake.state, { handlers: new Map(), emitted: [], ack: undefined, connected: false, disconnected: false });
});

describe("startRealtime", () => {
  it("marks requests as stale on request and message events and vehicles on status changes", () => {
    startRealtime(client);

    emit("request.updated", { requestId: "r1" });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(["requests", "unread", "request-counts", "request", "messages"]));

    invalidate.mockClear();
    emit("message.created", { message: { requestId: "r2" } });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(["request", "messages"]));

    invalidate.mockClear();
    emit("vehicle.status_changed", { vehicleId: "v1" });
    expect(invalidatedKeys()).toEqual(["vehicles", "vehicle"]);
  });

  it("re-reads everything after every connect, because events could be missed before it", () => {
    startRealtime(client);
    emit("connect");
    expect(invalidate).toHaveBeenCalledWith();
  });

  it("returns a function that closes the connection", () => {
    startRealtime(client)();
    expect(fake.state.disconnected).toBe(true);
  });
});

describe("joinRequestRoom", () => {
  it("joins a room at once when connected and leaves it with the last subscriber", () => {
    startRealtime(client);
    fake.state.connected = true;

    const first = joinRequestRoom("r1");
    const second = joinRequestRoom("r1");
    expect(fake.state.emitted.filter(([e]) => e === "request.join")).toHaveLength(2);

    first();
    expect(fake.state.emitted.some(([e]) => e === "request.leave")).toBe(false);
    second();
    expect(fake.state.emitted).toContainEqual(["request.leave", { requestId: "r1" }]);
  });

  it("joins the open dialogs when the connection comes up and re-reads the dialog after a successful join", () => {
    startRealtime(client);
    const leave = joinRequestRoom("r9");
    expect(fake.state.emitted).toEqual([]);

    emit("connect");
    expect(fake.state.emitted).toContainEqual(["request.join", { requestId: "r9" }]);

    invalidate.mockClear();
    fake.state.ack?.({ ok: true });
    expect(invalidatedKeys()).toEqual(expect.arrayContaining(["request", "messages"]));
    leave();
  });

  it("does not re-read the dialog when the server refuses the join", () => {
    startRealtime(client);
    fake.state.connected = true;
    const leave = joinRequestRoom("r5");
    invalidate.mockClear();
    fake.state.ack?.({ ok: false });
    expect(invalidate).not.toHaveBeenCalled();
    leave();
  });
});
