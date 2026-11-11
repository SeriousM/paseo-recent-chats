import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";

/** In place of a row's text while its chat is renamed. Enter or the check saves; Escape or the cross cancels. */
export function RenameField({
  theme,
  compact,
  initial,
  onSave,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  initial: string;
  onSave(title: string): Promise<void>;
  onClose(): void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = value.trim();
  const save = async () => {
    if (saving) return;
    if (!title || title === initial) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(title);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setSaving(false);
    }
  };
  const button = compact ? 36 : 26;
  const iconButton = { width: button, height: button, borderRadius: 7, alignItems: "center" as const, justifyContent: "center" as const };
  return (
    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <TextInput
          accessibilityLabel="New chat title"
          value={value}
          onChangeText={setValue}
          autoFocus
          selectTextOnFocus
          editable={!saving}
          maxLength={200}
          returnKeyType="done"
          onSubmitEditing={() => void save()}
          onKeyPress={(event) => {
            if (event.nativeEvent.key === "Escape") onClose();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: compact ? 14 : 13,
            paddingVertical: compact ? 8 : 4,
            paddingHorizontal: 8,
            borderRadius: 6,
            borderWidth: 1,
            borderColor: theme.colors.accent,
            color: theme.colors.foreground,
            backgroundColor: theme.colors.surface0,
          }}
        />
        {saving ? (
          <ActivityIndicator size="small" color={theme.colors.foregroundMuted} />
        ) : (
          <>
            <Pressable accessibilityRole="button" accessibilityLabel="Save title" onPress={() => void save()} style={iconButton}>
              <Icon name="Check" size={14} color={theme.colors.accent} />
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel="Cancel renaming" onPress={onClose} style={iconButton}>
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          </>
        )}
      </View>
      {error ? <Text style={{ fontSize: 11, color: theme.colors.statusDanger }}>{`Not renamed: ${error}`}</Text> : null}
    </View>
  );
}
