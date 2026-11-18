import { describe, expect, it, vi } from "vitest";

vi.mock("@getpaseo/plugin/client", () => ({ useHosts: () => [] }));

import { GO_SCREEN_ID, limitsOf, openChat } from "../client/use-recents";
import { browsedChat, endBrowsing } from "../client/browse";
import type { RecentsStore } from "../client/store";
import type { TriageRow } from "../client/triage";
import { prefsSettings } from "../shared/settings";

const row = { key: "h:a", hostId: "h", agentId: "a", bucket: "unread", led: "finished", sortAt: 1000 } as TriageRow;

function store() {
  const markRead = vi.fn();
  const keepUnread = vi.fn();
  const s = { markRead, keepUnread, getSnapshot: () => ({ chats: [] }) } as unknown as RecentsStore;
  return { markRead, keepUnread, store: s };
}

describe("openChat", () => {
  it("opens a waiting chat through navigation, on its host, and keeps it unread until you act in it", () => {
    endBrowsing();
    const { store: s, markRead, keepUnread } = store();
    const openAgent = vi.fn();
    openChat(s, row, { navigation: { openAgent }, openScreen: vi.fn() });
    expect(openAgent).toHaveBeenCalledWith({ agentId: "a", serverId: "h" });
    expect(markRead).not.toHaveBeenCalled();
    expect(keepUnread).toHaveBeenCalledWith("h:a", 1000);
    expect(browsedChat()).toBe("h:a");
  });

  it("goes through the redirect screen where there is no navigation", () => {
    const { store: s } = store();
    const openScreen = vi.fn();
    openChat(s, row, { openScreen });
    expect(openScreen).toHaveBeenCalledWith({ screenId: GO_SCREEN_ID, params: { agentId: "a", serverId: "h" } });
  });

  it("does not keep a chat that does not wait for you", () => {
    const { store: s, keepUnread } = store();
    openChat(s, { ...row, bucket: "inactive", led: "idle" }, { openScreen: vi.fn() });
    expect(keepUnread).not.toHaveBeenCalled();
    expect(browsedChat()).toBeNull();
  });

  it("does nothing when there is no way to open the chat", () => {
    endBrowsing();
    const { store: s, keepUnread } = store();
    openChat(s, row, {});
    expect(keepUnread).not.toHaveBeenCalled();
    expect(browsedChat()).toBeNull();
  });
});

describe("limitsOf", () => {
  it("takes the caps and windows from the preferences", () => {
    const prefs = { ...prefsSettings.schema.parse({}), maxUnread: 2, maxRunning: 0, maxInactive: 5, inactiveWindowDays: 3, unreadExpiryDays: 1 };
    expect(limitsOf(prefs)).toEqual({ maxUnread: 2, maxRunning: 0, maxInactive: 5, inactiveWindowDays: 3, unreadExpiryDays: 1 });
  });
});
