// Hosts switched off in the host filter (serverIds). Kept on this device (browser or desktop profile), not
// synced: a phone and a desktop filter separately. Phones keep it in memory. Shared on globalThis so every
// host's copy of the plugin in this app sees the same; like view-mode.ts, change the key with the shape.
import { readDeviceValue, writeDeviceValue } from "./web";

const KEY = "__paseoRecentChats.hiddenHosts.v1";
const STORAGE_KEY = "paseo-recent-chats:hidden-hosts:v1";

interface Shared {
  value: readonly string[];
  listeners: Set<() => void>;
}

function load(): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(readDeviceValue(STORAGE_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { value: load(), listeners: new Set() });
}

export const currentHiddenHosts = (): readonly string[] => shared().value;

export function setHiddenHosts(ids: readonly string[]): void {
  const state = shared();
  state.value = [...ids];
  writeDeviceValue(STORAGE_KEY, JSON.stringify(state.value));
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

export function subscribeHiddenHosts(listener: () => void): () => void {
  const state = shared();
  state.listeners.add(listener);
  return () => void state.listeners.delete(listener);
}

/** Switch one host on or off in the filter. Ids of hosts that no longer exist are dropped. */
export function toggleHiddenHost(hidden: readonly string[], hostId: string, knownHostIds: readonly string[]): string[] {
  const next = new Set(hidden.filter((id) => knownHostIds.includes(id)));
  if (next.has(hostId)) next.delete(hostId);
  else next.add(hostId);
  return [...next];
}
