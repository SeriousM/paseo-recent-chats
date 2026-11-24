import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { useFontScale } from "./font-scale";
import { onEscapeKey } from "./web";

/** Search field with a clear button. Used by the sidebar list and the all-chats screen. */
export function SearchBox({
  theme,
  compact,
  value,
  onChange,
  placeholder = "Search chats",
  autoFocus = false,
  onEscape,
}: {
  theme: PluginTheme;
  compact: boolean;
  value: string;
  onChange(text: string): void;
  placeholder?: string;
  autoFocus?: boolean;
  /** Escape while typing in the field (desktop and web). */
  onEscape?: () => void;
}) {
  const height = compact ? 44 : 32;
  const fs = useFontScale();
  const box = useRef<View>(null);
  const [focused, setFocused] = useState(false);
  const latestEscape = useRef(onEscape);
  latestEscape.current = onEscape;
  useEffect(() => onEscapeKey(box.current, () => latestEscape.current?.()), []);
  return (
    <View
      ref={box}
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: height,
        paddingLeft: 10,
        borderRadius: 8,
        borderWidth: 1,
        // One quiet frame; focus only lifts its border a little (no accent ring).
        borderColor: focused ? theme.colors.foregroundMuted : theme.colors.border,
        backgroundColor: theme.colors.surface1,
      }}
    >
      <Icon name="Search" size={14} color={theme.colors.foregroundMuted} />
      <TextInput
        accessibilityLabel={placeholder}
        placeholder={placeholder}
        placeholderTextColor={theme.colors.foregroundMuted}
        value={value}
        onChangeText={onChange}
        autoCorrect={false}
        autoCapitalize="none"
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        // A plain React Native field: the plugin UI one draws its own frame and green focus ring inside ours.
        style={{
          flex: 1,
          minWidth: 0,
          height,
          paddingHorizontal: 8,
          borderWidth: 0,
          backgroundColor: "transparent",
          outlineWidth: 0,
          color: theme.colors.foreground,
          fontSize: fs(13),
        }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChange("")}
          style={{ width: height, height, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}
