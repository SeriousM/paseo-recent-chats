// Own icon and colour of a project or workspace (prefs.treeStyles), and the panel that picks them, opened
// from the item's ⋮ menu. Idea from Paseo's Project Groups plugin. Synced like pins.
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState, useSyncExternalStore } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import type { Prefs } from "../shared/settings";
import { hostColors, TREE_COLORS } from "./format";
import { useFontScale } from "./font-scale";
import { getStore } from "./runtime";
import { isDark } from "./triage-list";

export type TreeStyle = Prefs["treeStyles"][string];

/** Lucide icons offered for projects and workspaces. */
const ICONS = [
  "Folder", "FolderGit2", "Code", "Terminal", "Globe", "Server", "Database", "Smartphone", "Monitor", "Package",
  "Rocket", "FlaskConical", "BookOpen", "FileText", "PenTool", "Palette", "Briefcase", "Building2", "House", "Users",
  "Heart", "Star", "Zap", "Bot", "Brain", "GraduationCap", "Shield", "Cloud", "Gamepad2", "Music", "Camera", "Leaf",
  "Anchor", "Waves", "Flag", "Lightbulb", "GitBranch", "Bug", "Wrench", "ShoppingCart", "Mail", "Calendar",
] as const;

/** The colour of an item's name and icon; undefined keeps the default. */
export function treeColor(style: TreeStyle | undefined, theme: PluginTheme): string | undefined {
  return hostColors(style?.color, isDark(theme.colors.surface0))?.text;
}

/** An item's icon: its emoji, its own icon or the default one, in its colour. */
export function TreeIcon({ style, fallback, color, size }: { style: TreeStyle | undefined; fallback: string; color: string; size: number }) {
  if (style?.emoji) return <Text style={{ fontSize: size, lineHeight: size + 3 }}>{style.emoji}</Text>;
  return <Icon name={style?.icon ?? fallback} size={size} color={color} />;
}

export function setTreeStyle(key: string, style: TreeStyle | null): void {
  const store = getStore();
  const next = { ...store.getSnapshot().prefs.treeStyles };
  if (style && (style.color || style.icon || style.emoji)) next[key] = style;
  else delete next[key];
  store.updatePrefs({ treeStyles: next });
}

/** Colour, icon and emoji for one item; Done saves, Reset goes back to the default. */
export function TreeStyleEditor({
  theme,
  compact,
  name,
  styleKey,
  initial,
  fallbackIcon,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  name: string;
  styleKey: string;
  initial: TreeStyle | undefined;
  fallbackIcon: string;
  onClose(): void;
}) {
  const fs = useFontScale();
  const [draft, setDraft] = useState<TreeStyle>(initial ?? {});
  const dark = isDark(theme.colors.surface0);
  const tint = treeColor(draft, theme) ?? theme.colors.foreground;
  const cell = compact ? 36 : 28;
  const choice = (on: boolean) => ({
    width: cell,
    height: cell,
    borderRadius: 8,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    borderWidth: 1,
    borderColor: on ? theme.colors.accent : "transparent",
    backgroundColor: on ? theme.colors.surface2 : "transparent",
  });
  const button = (label: string, onPress: () => void, primary = false) => (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{ paddingHorizontal: 12, height: compact ? 40 : 30, borderRadius: 8, justifyContent: "center", backgroundColor: primary ? theme.colors.accent : "transparent" }}
    >
      <Text style={{ fontSize: fs(12), fontWeight: primary ? "600" : "400", color: primary ? theme.colors.accentForeground : theme.colors.foregroundMuted }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ margin: 6, padding: 10, gap: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface1 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TreeIcon style={draft} fallback={fallbackIcon} color={tint} size={14} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(13), fontWeight: "600", color: tint }}>{name}</Text>
      </View>
      <Text style={{ fontSize: fs(11), color: theme.colors.foregroundMuted }}>Color</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
        <Pressable accessibilityRole="radio" accessibilityLabel="No color" accessibilityState={{ selected: !draft.color }} onPress={() => setDraft({ ...draft, color: undefined })} style={choice(!draft.color)}>
          <Icon name="Ban" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
        {TREE_COLORS.map((color) => (
          <Pressable key={color} accessibilityRole="radio" accessibilityLabel={color} accessibilityState={{ selected: draft.color === color }} onPress={() => setDraft({ ...draft, color })} style={choice(draft.color === color)}>
            <View style={{ width: cell - 14, height: cell - 14, borderRadius: (cell - 14) / 2, backgroundColor: hostColors(color, dark)?.text }} />
          </Pressable>
        ))}
      </View>
      <Text style={{ fontSize: fs(11), color: theme.colors.foregroundMuted }}>Icon</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 2 }}>
        {ICONS.map((icon) => {
          const on = !draft.emoji && (draft.icon ?? fallbackIcon) === icon;
          return (
            <Pressable key={icon} accessibilityRole="radio" accessibilityLabel={icon} accessibilityState={{ selected: on }} onPress={() => setDraft({ ...draft, icon, emoji: undefined })} style={choice(on)}>
              <Icon name={icon} size={14} color={tint} />
            </Pressable>
          );
        })}
      </View>
      <TextInput
        value={draft.emoji ?? ""}
        onChangeText={(text) => setDraft({ ...draft, emoji: Array.from(text.trim()).slice(0, 2).join("") || undefined })}
        placeholder="Or type an emoji (for example 🚀)"
        placeholderTextColor={theme.colors.foregroundMuted}
        style={{ height: compact ? 40 : 30, paddingHorizontal: 8, borderRadius: 8, borderWidth: 1, borderColor: theme.colors.border, backgroundColor: theme.colors.surface0, color: theme.colors.foreground, fontSize: fs(13) }}
      />
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        {button("Reset", () => {
          setTreeStyle(styleKey, null);
          onClose();
        })}
        <View style={{ flex: 1 }} />
        {button("Cancel", onClose)}
        {button(
          "Done",
          () => {
            setTreeStyle(styleKey, draft);
            onClose();
          },
          true,
        )}
      </View>
    </View>
  );
}

/** An item's style, following the synced settings. */
export function useTreeStyle(key: string): TreeStyle | undefined {
  const store = getStore();
  return useSyncExternalStore(store.subscribe, () => store.getSnapshot().prefs.treeStyles[key]);
}
