// Which chat is open on screen. Plugins are not told, but a composer pill's icon renders with its chat's
// composer, so the pill icons report their chat here. The app keeps chats mounted that are not on screen
// (earlier tabs on desktop, earlier screens in a phone's stack), so mounting alone is not enough: on the
// web the icons also report when they are hidden or shown again (a hidden tab has no size). The open
// chat is the visible one shown most recently. Shared on globalThis so the copy of whichever host renders
// the sidebar sees chats of every host. Like peers.ts, the shape is a contract between plugin versions:
// change it together with the key.
import { useSyncExternalStore } from "react";

const OPEN_KEY = "__paseoRecentChats.openChats.v2";

interface ShownChat {
  key: string;
  visible: boolean;
  /** Increases each time the icon is mounted or becomes visible again. */
  shownAt: number;
}

interface SharedOpenChats {
  /** One entry per mounted pill icon. */
  icons: Set<ShownChat>;
  counter: number;
  listeners: Set<() => void>;
}

function shared(scope: object = globalThis): SharedOpenChats {
  const holder = scope as Record<string, SharedOpenChats | undefined>;
  return (holder[OPEN_KEY] ??= { icons: new Set(), counter: 0, listeners: new Set() });
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

export interface ShownChatHandle {
  /** Where visibility is known (web): hidden icons do not count, and showing one again makes it the newest. */
  setVisible(visible: boolean): void;
  remove(): void;
}

/** Reports `key` as shown by a mounted icon until `remove` is called. */
export function reportOpenChat(key: string): ShownChatHandle {
  const state = shared();
  const entry: ShownChat = { key, visible: true, shownAt: ++state.counter };
  state.icons.add(entry);
  notify(state);
  return {
    setVisible(visible) {
      if (visible === entry.visible) return;
      entry.visible = visible;
      if (visible) entry.shownAt = ++state.counter;
      notify(state);
    },
    remove() {
      if (state.icons.delete(entry)) notify(state);
    },
  };
}

export function currentOpenChat(): string | null {
  let newest: ShownChat | null = null;
  for (const entry of shared().icons) {
    if (entry.visible && (!newest || entry.shownAt > newest.shownAt)) newest = entry;
  }
  return newest?.key ?? null;
}

/** Key of the chat open on screen, or null when none is known. */
export function useOpenChat(): string | null {
  return useSyncExternalStore((listener) => {
    const state = shared();
    state.listeners.add(listener);
    return () => void state.listeners.delete(listener);
  }, currentOpenChat);
}
