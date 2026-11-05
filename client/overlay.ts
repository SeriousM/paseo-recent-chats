// Pure read/unread transitions on the overlay. Persistence lives in the store.
import type { Overlay } from "./triage";

const PRUNE_AFTER_MS = 30 * 86_400_000;

/** Opening a chat or pressing the check button: dismisses native attention and a Later mark. */
export function markRead(overlay: Overlay, keys: readonly string[], now: number): Overlay {
  const next = { ...overlay };
  for (const key of keys) next[key] = { ...next[key], dismissedAt: now };
  return next;
}

/** Later: unread again until the chat is next opened or dismissed. */
export function markUnread(overlay: Overlay, key: string, now: number): Overlay {
  return { ...overlay, [key]: { ...overlay[key], unreadAt: now } };
}

/** Pin a chat: it is listed first until unpinned. Pinning an already pinned chat keeps its place. */
export function pinChat(overlay: Overlay, key: string, now: number): Overlay {
  if (overlay[key]?.pinnedAt !== undefined) return overlay;
  return { ...overlay, [key]: { ...overlay[key], pinnedAt: now } };
}

/** Unpin a chat. An entry left with no information is removed. */
export function unpinChat(overlay: Overlay, key: string): Overlay {
  const entry = overlay[key];
  if (entry?.pinnedAt === undefined) return overlay;
  const { pinnedAt: _pinnedAt, ...rest } = entry;
  const next = { ...overlay };
  if (Object.keys(rest).length === 0) delete next[key];
  else next[key] = rest;
  return next;
}

/**
 * Drop entries for chats that no longer exist and entries untouched for a month (pins excepted).
 * `live` null means the chat list is not loaded yet: keep everything.
 */
export function pruneOverlay(overlay: Overlay, live: ReadonlySet<string> | null, now: number): Overlay {
  if (!live) return overlay;
  const next: Record<string, Overlay[string]> = {};
  for (const [key, entry] of Object.entries(overlay)) {
    const touched = Math.max(entry.unreadAt ?? 0, entry.dismissedAt ?? 0);
    // A pin never ages out; it goes when the chat does or when it is unpinned.
    const keep = entry.pinnedAt !== undefined || now - touched < PRUNE_AFTER_MS;
    if (live.has(key) && keep) next[key] = entry;
  }
  return Object.keys(next).length === Object.keys(overlay).length ? overlay : next;
}
