// A short in-memory log of what the plugin did, for the diagnostics report: the steps of Alt+R and of going
// back and forward. Shared on globalThis, so every host's copy of the plugin writes to the same log. No titles,
// only chat keys and states. Kept until the app restarts; the newest entries win.
const KEY = "__paseoRecentChats.trace.v1";
const MAX_ENTRIES = 200;

interface Entry {
  at: string;
  event: string;
  data?: Record<string, unknown>;
}

const entries = (): Entry[] => ((globalThis as Record<string, unknown>)[KEY] ??= []) as Entry[];

export function trace(event: string, data?: Record<string, unknown>): void {
  const log = entries();
  log.push({ at: new Date().toISOString().slice(11, 23), event, ...(data ? { data } : null) });
  if (log.length > MAX_ENTRIES) log.splice(0, log.length - MAX_ENTRIES);
}

export const traceLog = (): readonly Entry[] => [...entries()];
