// Opening a chat that waits for you (from the list or the visit history) leaves it unread until you do
// something in it: type in its composer or click into its messages. Which chat is being looked at is shared
// on globalThis, since the copy of whichever host renders the sidebar opens it and every copy watches for the
// interaction. Like peers.ts, the shape is a contract between plugin versions: change it with the key.
import { useSyncExternalStore } from "react";

const KEY = "__paseoRecentChats.browsing.v2";

interface Shared {
  /** The unread chat opened and not yet interacted with; null when there is none. */
  key: string | null;
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { key: null, listeners: new Set() });
}

function set(key: string | null): void {
  const state = shared();
  if (state.key === key) return;
  state.key = key;
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

export const startBrowsing = (key: string): void => set(key);

export const endBrowsing = (): void => set(null);

export const browsedChat = (): string | null => shared().key;

export function subscribeBrowsing(listener: () => void): () => void {
  const state = shared();
  state.listeners.add(listener);
  return () => void state.listeners.delete(listener);
}

export const useBrowsedChat = (): string | null => useSyncExternalStore(subscribeBrowsing, browsedChat, browsedChat);
