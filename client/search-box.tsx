import type { PluginTheme } from "@getpaseo/plugin";
import { Icon, TextInput } from "@getpaseo/plugin/client/ui";
import { Pressable, View } from "react-native";
import { useFontScale } from "./font-scale";

/** Search field with a clear button. Used by the sidebar list and the all-chats screen. */
export function SearchBox({
  theme,
  compact,
  value,
  onChange,
  placeholder = "Search chats",
  autoFocus = false,
}: {
  theme: PluginTheme;
  compact: boolean;
  value: string;
  onChange(text: string): void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const height = compact ? 44 : 32;
  const fs = useFontScale();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        minHeight: height,
        paddingLeft: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: theme.colors.border,
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
        style={{ flex: 1, minWidth: 0, height, paddingHorizontal: 8, color: theme.colors.foreground, fontSize: fs(13) }}
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
