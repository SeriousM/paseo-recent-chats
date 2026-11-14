// Back and forward through the chats that were open on screen, like a browser's history. Every chat that
// becomes the open one (see open-chat.ts) is recorded; going back or forward opens the chat there without
// recording it again. In memory only. Shared on globalThis: opening a chat of another host hands the sidebar
// to that host's copy of the plugin, which must see the same history. Like peers.ts, the shape is a contract
// between plugin versions: change it together with the key.
import { useSyncExternalStore } from "react";

const HISTORY_KEY = "__paseoRecentChats.history.v1";
/** Older visits are dropped beyond this many. */
const MAX_ENTRIES = 50;

export interface ChatHistory {
  /** Chat keys in the order they were open; consecutive repeats are folded. */
  entries: readonly string[];
  /** Position of the chat on screen in `entries`; -1 while empty. */
  index: number;
}

export const EMPTY_HISTORY: ChatHistory = { entries: [], index: -1 };

/**
 * `key` became the open chat. The chat at the current position changes nothing (going back or forward
 * lands there); another one drops whatever lay ahead and becomes the newest entry.
 */
export function visit(history: ChatHistory, key: string): ChatHistory {
  if (history.entries[history.index] === key) return history;
  const entries = [...history.entries.slice(0, history.index + 1), key].slice(-MAX_ENTRIES);
  return { entries, index: entries.length - 1 };
}

/** The history after going `by` steps (-1 back, 1 forward), with the chat to open; null at either end. */
export function step(history: ChatHistory, by: -1 | 1): { history: ChatHistory; key: string } | null {
  const index = history.index + by;
  const key = history.entries[index];
  return key === undefined ? null : { history: { ...history, index }, key };
}

interface Shared {
  history: ChatHistory;
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[HISTORY_KEY] ??= { history: EMPTY_HISTORY, listeners: new Set() });
}

function set(next: ChatHistory): void {
  const state = shared();
  if (next === state.history) return;
  state.history = next;
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

/** Records `key` as the chat now open on screen. */
export const recordOpenChat = (key: string): void => set(visit(shared().history, key));

/** Moves back or forward and returns the chat key to open, or null when there is none. */
export function moveInHistory(by: -1 | 1): string | null {
  const next = step(shared().history, by);
  if (!next) return null;
  set(next.history);
  return next.key;
}

export function useChatHistory(): ChatHistory {
  return useSyncExternalStore(
    (listener) => {
      const state = shared();
      state.listeners.add(listener);
      return () => void state.listeners.delete(listener);
    },
    () => shared().history,
  );
}
