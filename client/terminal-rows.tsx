// Terminal rows: under a workspace in the Projects tree, and the Terminals list of a Triage search.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { useFontScale } from "./font-scale";
import { fuzzyScore } from "./fuzzy";
import { openTerminalByKey, useTerminalList } from "./terminals";

/** A terminal's row: its icon and title, and where it is when `context` is given. A press opens its tab. */
export function TerminalRow({
  theme,
  compact,
  terminal,
  context,
  onOpen,
}: {
  theme: PluginTheme;
  compact: boolean;
  terminal: { key: string; title: string };
  context?: string;
  /** Runs before the tab opens (a search is cleared, a popup closes). */
  onOpen?: () => void;
}) {
  const fs = useFontScale();
  const known = useTerminalList().some((item) => item.key === terminal.key);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Terminal ${terminal.title}${context ? `, ${context}` : ""}`}
      disabled={!known}
      onPress={() => {
        onOpen?.();
        openTerminalByKey(terminal.key);
      }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 7,
        paddingHorizontal: 10,
        minHeight: compact ? 40 : 24,
        borderRadius: 6,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name="SquareTerminal" size={13} color={theme.colors.foregroundMuted} />
      <Text numberOfLines={1} style={{ flexShrink: 1, fontSize: fs(13), color: theme.colors.foregroundMuted }}>
        {terminal.title || "Terminal"}
      </Text>
      {context ? (
        <Text numberOfLines={1} style={{ flex: 1, minWidth: 0, fontSize: fs(11), color: theme.colors.foregroundMuted, opacity: 0.8 }}>
          {context}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Triage search: the terminals whose title, workspace or project matches, as their own list under the chats. */
export function TerminalSearchList({
  theme,
  compact,
  query,
  hiddenHosts,
  workspaces,
  onOpen,
}: {
  theme: PluginTheme;
  compact: boolean;
  query: string;
  hiddenHosts: readonly string[];
  workspaces: readonly { hostId: string; id: string; title: string; treeProject: string }[];
  onOpen?: () => void;
}) {
  const fs = useFontScale();
  const terminals = useTerminalList();
  const found = useMemo(() => {
    const words = query.trim().split(/\s+/).filter(Boolean);
    return terminals.flatMap((terminal) => {
      if (hiddenHosts.includes(terminal.hostId)) return [];
      const workspace = workspaces.find((w) => w.hostId === terminal.hostId && w.id === terminal.workspaceId);
      const fields = [terminal.title, workspace?.title ?? "", workspace?.treeProject ?? ""];
      if (!words.every((word) => fields.some((field) => fuzzyScore(word, field) !== null))) return [];
      return [{ terminal, context: workspace ? `${workspace.treeProject} \u00B7 ${workspace.title}` : "" }];
    });
  }, [terminals, query, hiddenHosts, workspaces]);
  if (found.length === 0) return null;
  return (
    <View style={{ marginTop: 6 }}>
      <Text
        style={{
          fontSize: fs(10.5),
          letterSpacing: 0.7,
          textTransform: "uppercase",
          fontWeight: "600",
          color: theme.colors.foregroundMuted,
          paddingHorizontal: 10,
          paddingVertical: compact ? 8 : 4,
        }}
      >
        Terminals
      </Text>
      {found.map(({ terminal, context }) => (
        <TerminalRow key={terminal.key} theme={theme} compact={compact} terminal={terminal} context={context} onOpen={onOpen} />
      ))}
    </View>
  );
}
