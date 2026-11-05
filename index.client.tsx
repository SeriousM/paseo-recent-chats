import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GoScreen } from "./client/go-screen";
import { registerPills } from "./client/pills";
import { RecentScreen } from "./client/recent-screen";
import { getStore, SETTINGS_SCREEN_ID, setSettingsOpener, setStore } from "./client/runtime";
import { SettingsScreen } from "./client/settings-screen";
import { RECENT_SCREEN_ID, RecentSidebarItem } from "./client/sidebar-item";
import { createStore } from "./client/store";
import { GO_SCREEN_ID } from "./client/use-recents";

export default function contribute(client: PluginClientContext) {
  setStore(createStore((contract, input) => client.rpc(contract, input)));
  setSettingsOpener(() => client.openSettings(SETTINGS_SCREEN_ID));

  const cleanups = [
    client.addScreen({ id: RECENT_SCREEN_ID, title: "Recent Chats", Component: RecentScreen }),
    client.addScreen({ id: GO_SCREEN_ID, title: "Opening chat", Component: GoScreen }),
    client.addSettingsScreen({ id: SETTINGS_SCREEN_ID, title: "Recent Chats", icon: "Inbox", Component: SettingsScreen }),
    client.addSidebarHeaderItem({ id: "recent", title: "Recent Chats", Component: RecentSidebarItem }),
    client.addCommandCenterItem({
      id: "open-recent-chats",
      title: "Recent Chats",
      icon: "Inbox",
      keywords: ["inbox", "unread", "switch", "chat", "agent"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: RECENT_SCREEN_ID }),
    }),
    registerPills(client),
  ];

  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
    getStore().dispose();
    setStore(null);
    setSettingsOpener(null);
  };
}
