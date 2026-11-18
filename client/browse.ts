// Browsing the visit history (back and forward, Alt+← / Alt+→) leaves an unread chat unread until you do
// something in it: type in its composer or click into its messages. Which chat is being browsed is shared on
// globalThis, since the copy of whichever host renders the sidebar steps the history and every copy watches
// for the interaction. Like peers.ts, the shape is a contract between plugin versions: change it with the key.
const KEY = "__paseoRecentChats.browsing.v1";

interface Shared {
  /** The unread chat opened from the history and not yet interacted with; null when there is none. */
  key: string | null;
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { key: null });
}

export const startBrowsing = (key: string | null): void => {
  shared().key = key;
};

export const browsedChat = (): string | null => shared().key;

export const endBrowsing = (): void => {
  shared().key = null;
};
