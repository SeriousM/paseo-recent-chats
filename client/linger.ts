// A waiting chat that was just opened stays in its Needs you place (with a grey light) instead of
// jumping to Inactive under the pointer. It stays until another chat is open on screen, another chat is
// opened from a list, or its state changes (a new turn or new attention puts it where it belongs anyway).
// In memory only, like the folded groups.
import { useSyncExternalStore } from "react";
import type { AgentStatus } from "./triage";

export interface Linger {
  key: string;
  /** Where it sorted while it was waiting, so it keeps its place. */
  sortAt: number;
  /** Its status when it was opened; a change (a new turn, a stop) lets it go. */
  status: AgentStatus;
}

let linger: Linger | null = null;
/** The chat has been seen as the open one; once another chat is open, it lets go. */
let seenOpen = false;
const listeners = new Set<() => void>();

function set(next: Linger | null) {
  linger = next;
  seenOpen = false;
  for (const listener of [...listeners]) listener();
}

/** Keeps `key` in Needs you after it was opened; replaces any earlier one. */
export const currentLinger = (): Linger | null => linger;

export const holdOpened = (key: string, sortAt: number, status: AgentStatus): void => set({ key, sortAt, status });

/** Lets go once another chat than the held one is on screen. Called with the open chat whenever it changes. */
export function followOpenChat(openKey: string | null): void {
  if (!linger) return;
  if (openKey === linger.key) seenOpen = true;
  else if (seenOpen && openKey !== null) set(null);
}

export function useLinger(): Linger | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    currentLinger,
  );
}
