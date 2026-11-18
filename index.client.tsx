import type { PluginClientContext } from "@getpaseo/plugin/client";
import { GoScreen } from "./client/go-screen";
import { registerPills } from "./client/pills";
import { RecentScreen } from "./client/recent-screen";
import { getStore, SETTINGS_SCREEN_ID, setSettingsOpener, setStore } from "./client/runtime";
import { SettingsScreen } from "./client/settings-screen";
import { RECENT_SCREEN_ID, RecentSidebarItem } from "./client/sidebar-item";
import { RecentSidebarView, SIDEBAR_VIEW_ID } from "./client/sidebar-view";
import { createStore } from "./client/store";
import { GO_SCREEN_ID } from "./client/use-recents";
import { attachPromptJumpKeys, onChatInteraction } from "./client/web";
import { browsedChat, endBrowsing } from "./client/browse";
import { currentOpenChat } from "./client/open-chat";

export default function contribute(client: PluginClientContext) {
  setStore(
    createStore({
      rpc: (contract, input) => client.rpc(contract, input),
      resolveSelf: async () => (await client.paseo.hosts.list()).self.serverId,
    }),
  );
  setSettingsOpener(() => client.openSettings(SETTINGS_SCREEN_ID));

  const cleanups = [
    client.addScreen({ id: RECENT_SCREEN_ID, title: "Recent Chats", Component: RecentScreen }),
    client.addScreen({ id: GO_SCREEN_ID, title: "Opening chat", Component: GoScreen }),
    client.addSettingsScreen({ id: SETTINGS_SCREEN_ID, title: "Recent Chats", icon: "Inbox", Component: SettingsScreen }),
    client.addSidebarHeaderItem({ id: "recent", title: "Recent Chats", Component: RecentSidebarItem }),
    // Paseo 0.16 and later: Recent Chats can also be the whole sidebar. Older apps lack this; the item above stays.
    ...(typeof client.addSidebarView === "function"
      ? [
          client.addSidebarView({
            id: SIDEBAR_VIEW_ID,
            title: "Recent Chats",
            description: "Your chats by project or by what needs you, from every host",
            Component: (props) => <RecentSidebarView {...props} openScreen={(input) => client.openScreen(input)} />,
          }),
        ]
      : []),
    client.addCommandCenterItem({
      id: "open-recent-chats",
      title: "Recent Chats",
      icon: "Inbox",
      keywords: ["inbox", "unread", "switch", "chat", "agent"],
      context: "global",
      onSelect: ({ openScreen }) => openScreen({ screenId: RECENT_SCREEN_ID }),
    }),
    registerPills(client),
    attachPromptJumpKeys(),
    // A chat that was opened while it waited for you is marked read once you do something in it (see browse.ts).
    onChatInteraction(() => {
      const key = browsedChat();
      if (!key || key !== currentOpenChat()) return;
      endBrowsing();
      getStore().markRead([key]);
    }),
  ];

  return () => {
    for (const cleanup of cleanups.reverse()) void cleanup();
    getStore().dispose();
    setStore(null);
    setSettingsOpener(null);
  };
}
