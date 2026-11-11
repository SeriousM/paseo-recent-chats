// Which chat is open on screen. Plugins are not told, but a composer pill's icon renders only while its
// chat's composer is shown, so the pill icons report their chat here while mounted. The newest mounted
// one is the open chat; when it goes, the one shown before it (still mounted below in a phone's screen
// stack) takes over. Shared on globalThis so the copy of whichever host renders the sidebar sees chats
// of every host. Like peers.ts, the shape is a contract between plugin versions: change it together
// with the key.
import { useSyncExternalStore } from "react";

const OPEN_KEY = "__paseoRecentChats.openChats.v1";

interface SharedOpenChats {
  /** Chat keys of mounted pill icons, oldest mount first; a chat appears once per mounted icon. */
  mounted: string[];
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): SharedOpenChats {
  const holder = scope as Record<string, SharedOpenChats | undefined>;
  return (holder[OPEN_KEY] ??= { mounted: [], listeners: new Set() });
}

function notify(state: SharedOpenChats) {
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

/** Reports `key` as shown until the returned function is called. */
export function reportOpenChat(key: string): () => void {
  const state = shared();
  state.mounted.push(key);
  notify(state);
  return () => {
    const index = state.mounted.lastIndexOf(key);
    if (index === -1) return;
    state.mounted.splice(index, 1);
    notify(state);
  };
}

const currentOpenChat = (): string | null => shared().mounted.at(-1) ?? null;

/** Key of the chat open on screen, or null when none is known. */
export function useOpenChat(): string | null {
  return useSyncExternalStore((listener) => {
    const state = shared();
    state.listeners.add(listener);
    return () => void state.listeners.delete(listener);
  }, currentOpenChat);
}
