import { beforeEach, describe, expect, it, vi } from "vitest";
import { flushPendingResidents, getPendingResidentCount, queueResident } from "./offlineQueue";

const QUEUE_KEY = "canvass.pendingResidents.v1";

function readRawQueue() {
  return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
}

function makeMemoryStorage() {
  const data = new Map();
  return {
    getItem: vi.fn((key) => (data.has(key) ? data.get(key) : null)),
    setItem: vi.fn((key, value) => data.set(key, String(value))),
    removeItem: vi.fn((key) => data.delete(key)),
    clear: vi.fn(() => data.clear()),
  };
}

function mockSupabase(results) {
  const upsert = vi.fn().mockImplementation(() => {
    const next = results.shift() || { error: null };
    return Promise.resolve(next);
  });

  return {
    from: vi.fn(() => ({
      upsert,
    })),
    upsert,
  };
}

beforeEach(() => {
  vi.stubGlobal("localStorage", makeMemoryStorage());
  vi.stubGlobal("window", {
    dispatchEvent: vi.fn(),
  });
  vi.stubGlobal("CustomEvent", class CustomEvent {
    constructor(type) {
      this.type = type;
    }
  });
  vi.stubGlobal("crypto", {
    randomUUID: vi.fn(() => `uuid-${crypto.randomUUID.mock.calls.length + 1}`),
  });
  vi.stubGlobal("navigator", {
    onLine: true,
  });
});

describe("offline resident queue", () => {
  it("queues multiple offline residents instead of replacing the previous one", () => {
    queueResident({ street_number: "1", street_name: "Main" });
    queueResident({ street_number: "2", street_name: "Main" });
    queueResident({ street_number: "3", street_name: "Main" });

    const queue = readRawQueue();

    expect(getPendingResidentCount()).toBe(3);
    expect(queue.map((item) => item.payload.street_number)).toEqual(["1", "2", "3"]);
    expect(new Set(queue.map((item) => item.id)).size).toBe(3);
    expect(new Set(queue.map((item) => item.payload.client_entry_id)).size).toBe(3);
  });

  it("syncs every queued resident when the device is back online", async () => {
    queueResident({ street_number: "1", street_name: "Main" });
    queueResident({ street_number: "2", street_name: "Main" });
    queueResident({ street_number: "3", street_name: "Main" });
    const supabase = mockSupabase([{ error: null }, { error: null }, { error: null }]);

    const result = await flushPendingResidents(supabase);

    expect(result).toEqual({ synced: 3, remaining: 0 });
    expect(supabase.from).toHaveBeenCalledWith("residents");
    expect(supabase.upsert).toHaveBeenCalledTimes(3);
    expect(readRawQueue()).toEqual([]);
  });

  it("does not sync or clear queued residents while still offline", async () => {
    vi.stubGlobal("navigator", {
      onLine: false,
    });
    queueResident({ street_number: "1", street_name: "Main" });
    const supabase = mockSupabase([]);

    const result = await flushPendingResidents(supabase);

    expect(result).toEqual({ synced: 0, remaining: 1 });
    expect(supabase.upsert).not.toHaveBeenCalled();
    expect(getPendingResidentCount()).toBe(1);
  });

  it("preserves failed and not-yet-synced residents after a partial sync failure", async () => {
    queueResident({ street_number: "1", street_name: "Main" });
    queueResident({ street_number: "2", street_name: "Main" });
    queueResident({ street_number: "3", street_name: "Main" });
    const supabase = mockSupabase([
      { error: null },
      { error: new Error("Network timeout") },
    ]);

    const result = await flushPendingResidents(supabase);
    const queue = readRawQueue();

    expect(result).toEqual({ synced: 1, remaining: 2 });
    expect(supabase.upsert).toHaveBeenCalledTimes(2);
    expect(queue.map((item) => item.payload.street_number)).toEqual(["2", "3"]);
    expect(queue[0].attempts).toBe(1);
    expect(queue[0].last_error).toBe("Network timeout");
    expect(queue[1].attempts).toBe(0);
  });
});
