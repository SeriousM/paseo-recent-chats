// Whether Recent Chats is the sidebar view right now (Paseo 0.16 and later). The sidebar item then stands
// aside, so the list does not show twice. Every host's copy of the plugin registers its own sidebar item,
// but Paseo renders the view from one copy only, so the flag is shared on globalThis. Like peers.ts, the
// shape is a contract between plugin versions: change it together with the key.
import { useSyncExternalStore } from "react";

const KEY = "__paseoRecentChats.sidebarView.v1";

interface Shared {
  /** Mounted sidebar views; more than one only for a moment while the app swaps them. */
  mounted: number;
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { mounted: 0, listeners: new Set() });
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

/** Marks the sidebar view as shown until the returned function is called. */
export function markSidebarViewShown(): () => void {
  const state = shared();
  state.mounted += 1;
  notify(state);
  return () => {
    state.mounted -= 1;
    notify(state);
  };
}

export function useSidebarViewShown(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const state = shared();
      state.listeners.add(listener);
      return () => void state.listeners.delete(listener);
    },
    () => shared().mounted > 0,
  );
}
