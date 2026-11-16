import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

/**
 * Sidebar rows, pill popups and Command Center callbacks cannot navigate to a chat or a workspace; only
 * screens and panels get `navigation`. They open this screen with `agentId` or `workspaceId`, and it forwards.
 */
export function GoScreen({ theme, navigation, params }: PluginScreenProps) {
  const { agentId, workspaceId, serverId } = params;
  const openAgent = navigation?.openAgent;
  const openWorkspace = navigation?.openWorkspace;
  const open = agentId && openAgent
    ? () => openAgent(serverId ? { agentId, serverId } : { agentId })
    : workspaceId && openWorkspace
      ? () => openWorkspace(serverId ? { workspaceId, serverId } : { workspaceId })
      : null;
  // `navigation` may be a new object on every render; open each target once.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const target = `${serverId ?? ""}/${agentId ?? ""}/${workspaceId ?? ""}`;
    if (!open || opened.current === target) return;
    opened.current = target;
    open();
  }, [open, agentId, workspaceId, serverId]);
  if (open) return <Loading />;
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground }}>
        This version of Paseo cannot open a chat or a workspace from a plugin.
      </Text>
    </View>
  );
}
