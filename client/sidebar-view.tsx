// Recent Chats as the whole sidebar (Paseo 0.16 and later: Settings, Sidebar, Sidebar view). The same list
// as the sidebar item, filling the space between Paseo's header and footer. Paseo says which chat is open
// and opens chats by reference, so this view uses that instead of the pills and the go screen.
import type { AgentRef, PluginSidebarViewProps, ProjectRef, WorkspaceRef } from "@getpaseo/plugin/client";
// Only Paseo 0.16 has useAgents. A named import of it would stop the whole plugin from loading in an
// older app; through the namespace it is just absent there, and this view is only registered on 0.16.
import * as pluginClient from "@getpaseo/plugin/client";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { chatKey } from "./triage";
import { reportOpenChat } from "./open-chat";
import { HeaderControls, RecentPanel } from "./recent-panel";
import { markSidebarViewShown } from "./sidebar-view-state";
import type { OpenTarget } from "./use-recents";
import { NavigationContext, type PaseoNavigation } from "./navigation";

export const SIDEBAR_VIEW_ID = "recent-chats";

export function RecentSidebarView({
  theme,
  layout,
  active,
  navigation,
  openScreen,
}: PluginSidebarViewProps & { openScreen(input: { screenId: string; params?: Record<string, string> }): void }) {
  useEffect(() => markSidebarViewShown(), []);
  // The open chat as Paseo knows it: the highlight and the visit history follow it, also without pills.
  const activeKey = active.agent ? chatKey(active.agent.hostId, active.agent.id) : null;
  useEffect(() => {
    if (!activeKey) return;
    const shown = reportOpenChat(activeKey);
    return () => shown.remove();
  }, [activeKey]);
  // Paseo opens a chat by its reference; rows know host and agent id.
  const agents = pluginClient.useAgents();
  const refs = useMemo(() => new Map<string, AgentRef>(agents.map((ref) => [chatKey(ref.hostId, ref.id), ref])), [agents]);
  const target = useMemo<OpenTarget>(
    () => ({
      navigation: {
        openAgent: ({ agentId, serverId }) => {
          const ref = refs.get(chatKey(serverId ?? "", agentId));
          if (ref) navigation.openAgent(ref);
        },
      },
    }),
    [refs, navigation],
  );
  // Workspaces and projects open through Paseo too, by their references (the ⋮ menus).
  const workspaceRefs = pluginClient.useWorkspaces();
  const projectRefs = pluginClient.useProjects();
  const paseoNavigation = useMemo<PaseoNavigation>(() => {
    const workspaces = new Map<string, WorkspaceRef>(workspaceRefs.map((ref) => [`${ref.hostId}:${ref.id}`, ref]));
    const projects = new Map<string, ProjectRef>(projectRefs.map((ref) => [`${ref.hostId}:${ref.id}`, ref]));
    return {
      openWorkspace(hostId, workspaceId) {
        const ref = workspaces.get(`${hostId}:${workspaceId}`);
        if (ref) navigation.openWorkspace(ref);
      },
      newWorkspace(hostId, projectId) {
        const ref = projects.get(`${hostId}:${projectId}`);
        if (ref) navigation.openProject(ref);
      },
    };
  }, [workspaceRefs, projectRefs, navigation]);
  return (
    <NavigationContext.Provider value={paseoNavigation}>
      <View style={{ flex: 1, minHeight: 0 }}>
        <RecentPanel
          theme={theme}
          compact={layout.compact}
          target={target}
          onShowAll={(q) => openScreen({ screenId: "recent", params: q ? { q } : {} })}
          headerExtra={<HeaderControls theme={theme} compact={layout.compact} target={target} />}
        />
      </View>
    </NavigationContext.Provider>
  );
}
