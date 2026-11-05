import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Loading } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";

/**
 * Sidebar rows, pill popups and Command Center callbacks cannot navigate to a chat; only screens
 * and panels get `navigation`. They open this screen, which forwards to the chat.
 */
export function GoScreen({ theme, navigation, params }: PluginScreenProps) {
  const { agentId, serverId } = params;
  const openAgent = navigation?.openAgent;
  // `navigation` may be a new object on every render; open each target once.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    const target = `${serverId ?? ""}/${agentId ?? ""}`;
    if (!openAgent || !agentId || opened.current === target) return;
    opened.current = target;
    openAgent(serverId ? { agentId, serverId } : { agentId });
  }, [openAgent, agentId, serverId]);
  if (openAgent && agentId) return <Loading />;
  return (
    <View style={{ flex: 1, padding: 24, backgroundColor: theme.colors.surface0 }}>
      <Text style={{ color: theme.colors.foreground }}>
        This version of Paseo cannot open a chat from a plugin.
      </Text>
    </View>
  );
}
