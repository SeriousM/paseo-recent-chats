// Opening a chat that waits for you (from the list or the visit history) leaves it unread until you do
// something in it: type in its composer, click into its messages, or press Read (the Later pill, Alt+L).
// Which chat is being looked at is shared on globalThis, since the copy of whichever host renders the sidebar
// opens it and every copy watches for the interaction. Like peers.ts, the shape is a contract between plugin
// versions: change it together with the key.
const KEY = "__paseoRecentChats.browsing.v3";

interface Shared {
  /** The unread chat opened and not yet interacted with; null when there is none. */
  key: string | null;
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { key: null });
}

export const startBrowsing = (key: string): void => {
  shared().key = key;
};

export const endBrowsing = (): void => {
  shared().key = null;
};

export const browsedChat = (): string | null => shared().key;
