import { describe, expect, it, vi } from "vitest";

vi.mock("@getpaseo/plugin/client", () => ({ useHosts: () => [] }));

import { GO_SCREEN_ID, limitsOf, openChat } from "../client/use-recents";
import type { RecentsStore } from "../client/store";
import type { TriageRow } from "../client/triage";
import { prefsSettings } from "../shared/settings";

const row = { key: "h:a", hostId: "h", agentId: "a" } as TriageRow;

function store() {
  const markRead = vi.fn();
  return { markRead, store: { markRead } as unknown as RecentsStore };
}

describe("openChat", () => {
  it("opens through navigation, on the chat's host, and marks it read", () => {
    const { store: s, markRead } = store();
    const openAgent = vi.fn();
    openChat(s, row, { navigation: { openAgent }, openScreen: vi.fn() });
    expect(openAgent).toHaveBeenCalledWith({ agentId: "a", serverId: "h" });
    expect(markRead).toHaveBeenCalledWith(["h:a"]);
  });

  it("goes through the redirect screen where there is no navigation", () => {
    const { store: s, markRead } = store();
    const openScreen = vi.fn();
    openChat(s, row, { openScreen });
    expect(openScreen).toHaveBeenCalledWith({ screenId: GO_SCREEN_ID, params: { agentId: "a", serverId: "h" } });
    expect(markRead).toHaveBeenCalledWith(["h:a"]);
  });

  it("leaves the chat unread when there is no way to open it", () => {
    const { store: s, markRead } = store();
    openChat(s, row, {});
    expect(markRead).not.toHaveBeenCalled();
  });
});

describe("limitsOf", () => {
  it("takes the caps and windows from the preferences", () => {
    const prefs = { ...prefsSettings.schema.parse({}), maxUnread: 2, maxRunning: 0, maxInactive: 5, inactiveWindowDays: 3, unreadExpiryDays: 1 };
    expect(limitsOf(prefs)).toEqual({ maxUnread: 2, maxRunning: 0, maxInactive: 5, inactiveWindowDays: 3, unreadExpiryDays: 1 });
  });
});
