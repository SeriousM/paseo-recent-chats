// Alt+Shift+1 … 9 open the chats of Needs you by their place in the list on screen. The list that shows
// Needs you (the Projects strip or Triage) registers its chats in display order; the one registered last
// counts. While Alt+Shift is held the rows show their numbers. Shared on globalThis: every host's copy
// handles the keys, and the copy that renders the sidebar registers the list. Like peers.ts, the shape is a
// contract between plugin versions: change it together with the key.
import { useEffect, useSyncExternalStore } from "react";

const KEY = "__paseoRecentChats.numbered.v1";

interface Shared {
  /** Registered lists, oldest first; the last one is the one on screen. */
  lists: { id: object; keys: readonly string[] }[];
  /** Alt+Shift is held: rows show their numbers. */
  held: boolean;
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { lists: [], held: false, listeners: new Set() });
}

function notify(state: Shared): void {
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

/** The chat keys of Needs you as the list on screen shows them. */
export const numberedChats = (): readonly string[] => shared().lists.at(-1)?.keys ?? [];

export function setNumbersShown(held: boolean): void {
  const state = shared();
  if (state.held === held) return;
  state.held = held;
  notify(state);
}

const subscribe = (listener: () => void) => {
  const state = shared();
  state.listeners.add(listener);
  return () => void state.listeners.delete(listener);
};

/** True while Alt+Shift is held. */
export const useNumbersShown = (): boolean => useSyncExternalStore(subscribe, () => shared().held, () => false);

/** Registers a list's Needs you chats, in display order, while it is mounted. An empty list registers nothing. */
export function useNumberedChats(keys: readonly string[]): void {
  const joined = keys.join("\n");
  useEffect(() => {
    if (!joined) return;
    const state = shared();
    const entry = { id: {}, keys: joined.split("\n") };
    state.lists.push(entry);
    return () => {
      state.lists = state.lists.filter((list) => list !== entry);
    };
  }, [joined]);
}
