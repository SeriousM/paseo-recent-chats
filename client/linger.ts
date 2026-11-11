// A waiting chat that was just opened stays in its Needs you place (with a grey light) instead of
// jumping to Inactive under the pointer. It stays until another chat is open on screen, another chat is
// opened from a list, or its state changes (a new turn or new attention puts it where it belongs anyway).
// In memory only, like the folded groups. Shared on globalThis: opening a chat of another host hands the
// sidebar to that host's copy of the plugin, which must see the same hold. Like peers.ts, the shape is a
// contract between plugin versions: change it together with the key.
import { useSyncExternalStore } from "react";
import type { AgentStatus } from "./triage";

const HOLD_KEY = "__paseoRecentChats.openedHold.v1";

export interface Linger {
  key: string;
  /** Where it sorted while it was waiting, so it keeps its place. */
  sortAt: number;
  /** Its status when it was opened; a change (a new turn, a stop) lets it go. */
  status: AgentStatus;
}

interface SharedHold {
  linger: Linger | null;
  /** The chat has been seen as the open one; once another chat is open, it lets go. */
  seenOpen: boolean;
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): SharedHold {
  const holder = scope as Record<string, SharedHold | undefined>;
  return (holder[HOLD_KEY] ??= { linger: null, seenOpen: false, listeners: new Set() });
}

function set(next: Linger | null) {
  const state = shared();
  state.linger = next;
  state.seenOpen = false;
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

export const currentLinger = (): Linger | null => shared().linger;

/** Keeps `key` in Needs you after it was opened; replaces any earlier one. */
export const holdOpened = (key: string, sortAt: number, status: AgentStatus): void => set({ key, sortAt, status });

/** Lets go once another chat than the held one is on screen. Called with the open chat whenever it changes. */
export function followOpenChat(openKey: string | null): void {
  const state = shared();
  if (!state.linger) return;
  if (openKey === state.linger.key) state.seenOpen = true;
  else if (state.seenOpen && openKey !== null) set(null);
}

export function useLinger(): Linger | null {
  return useSyncExternalStore((listener) => {
    const state = shared();
    state.listeners.add(listener);
    return () => void state.listeners.delete(listener);
  }, currentLinger);
}
