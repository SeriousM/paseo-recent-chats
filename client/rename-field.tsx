import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, Text, TextInput, View } from "react-native";
import { onEscapeKey } from "./web";
import { useFontScale } from "./font-scale";

/** In place of a row's text while its chat is renamed. Enter or ✓ saves; Escape, ✕ or leaving the field cancels. */
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
  const fs = useFontScale();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const title = value.trim();
  const input = useRef<TextInput>(null);
  /** Set once the field has taken the focus itself; earlier blurs (the double-click's last click) do not cancel. */
  const armed = useRef(false);
  // autoFocus alone loses to a double-click, whose last click lands after the field appears: focus and
  // select the whole title once that click is over.
  useEffect(() => {
    const timer = setTimeout(() => {
      input.current?.focus();
      input.current?.setSelection(0, initial.length);
      armed.current = true;
    }, 50);
    return () => clearTimeout(timer);
  }, [initial]);
  // Pressing ✓ or ✕ takes the focus from the field before the press lands: those must not count as
  // leaving the field.
  const pressingButton = useRef(false);
  const latestClose = useRef(onClose);
  latestClose.current = onClose;
  useEffect(() => onEscapeKey(input.current, () => latestClose.current()), []);
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
          ref={input}
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
          onBlur={() => {
            if (armed.current && !pressingButton.current && !saving) onClose();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: fs(compact ? 14 : 13),
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save title"
              onPressIn={() => {
                pressingButton.current = true;
              }}
              onPress={() => {
                pressingButton.current = false;
                void save();
              }}
              style={iconButton}
            >
              <Icon name="Check" size={14} color={theme.colors.accent} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel renaming"
              onPressIn={() => {
                pressingButton.current = true;
              }}
              onPress={onClose}
              style={iconButton}
            >
              <Icon name="X" size={14} color={theme.colors.foregroundMuted} />
            </Pressable>
          </>
        )}
      </View>
      {error ? <Text style={{ fontSize: fs(11), color: theme.colors.statusDanger }}>{`Not renamed: ${error}`}</Text> : null}
    </View>
  );
}
