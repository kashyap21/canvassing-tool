const QUEUE_KEY = "canvass.pendingResidents.v1";

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeQueue(queue) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  window.dispatchEvent(new CustomEvent("resident-queue-changed"));
}

function makeId() {
  if (crypto?.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function getPendingResidentCount() {
  return readQueue().length;
}

export function queueResident(payload) {
  const queued = {
    id: makeId(),
    queued_at: new Date().toISOString(),
    attempts: 0,
    last_error: "",
    payload: {
      ...payload,
      client_entry_id: makeId(),
    },
  };
  writeQueue([...readQueue(), queued]);
  return queued;
}

export async function flushPendingResidents(supabase) {
  const queue = readQueue();
  if (!queue.length || !navigator.onLine) return { synced: 0, remaining: queue.length };

  let synced = 0;
  const remaining = [];

  for (const [index, item] of queue.entries()) {
    const { error } = await supabase
      .from("residents")
      .upsert(item.payload, { onConflict: "client_entry_id", ignoreDuplicates: true });

    if (error) {
      remaining.push({
        ...item,
        attempts: item.attempts + 1,
        last_error: error.message,
      });
      remaining.push(...queue.slice(index + 1));
      break;
    }

    synced += 1;
  }

  writeQueue(remaining);
  return { synced, remaining: remaining.length };
}

export function isRetryableNetworkError(error) {
  const message = `${error?.message || ""} ${error?.name || ""}`.toLowerCase();
  return (
    !navigator.onLine ||
    message.includes("failed to fetch") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("load failed")
  );
}
