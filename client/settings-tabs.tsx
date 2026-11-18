import type { PluginTheme } from "@getpaseo/plugin";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";

/** A row of tab buttons; the chosen one is underlined in the accent colour. */
export function TabBar<Id extends string>({
  theme,
  compact,
  tabs,
  value,
  onChange,
}: {
  theme: PluginTheme;
  compact: boolean;
  tabs: readonly { id: Id; label: string }[];
  value: Id;
  onChange(next: Id): void;
}) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: "row", flexWrap: "wrap", borderBottomWidth: 1, borderColor: theme.colors.border }}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <Pressable
            key={tab.id}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(tab.id)}
            style={{
              minHeight: compact ? 44 : 34,
              paddingHorizontal: 12,
              justifyContent: "center",
              borderBottomWidth: 2,
              marginBottom: -1,
              borderColor: selected ? theme.colors.accent : "transparent",
            }}
          >
            <Text style={{ color: selected ? theme.colors.foreground : theme.colors.foregroundMuted, fontSize: 14, fontWeight: selected ? "600" : "400" }}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Two or more joined buttons, one chosen. */
export function Segmented<Id extends string>({
  theme,
  compact,
  label,
  options,
  value,
  onChange,
}: {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  options: readonly { id: Id; label: string }[];
  value: Id;
  onChange(next: Id): void;
}) {
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      style={{ flexDirection: "row", alignSelf: "flex-start", borderWidth: 1, borderColor: theme.colors.border, borderRadius: 8, overflow: "hidden" }}
    >
      {options.map((option) => {
        const selected = option.id === value;
        return (
          <Pressable
            key={option.id}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            onPress={() => onChange(option.id)}
            style={{
              minHeight: compact ? 40 : 28,
              paddingHorizontal: 12,
              justifyContent: "center",
              backgroundColor: selected ? theme.colors.accent : "transparent",
            }}
          >
            <Text style={{ color: selected ? theme.colors.accentForeground : theme.colors.foreground, fontSize: 12 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Draws an option that only matters while another switch is on: dimmed and not pressable while `off`. */
export function Dimmed({ off, children }: { off: boolean; children: ReactNode }) {
  return (
    <View pointerEvents={off ? "none" : "auto"} accessibilityState={{ disabled: off }} style={{ opacity: off ? 0.4 : 1 }}>
      {children}
    </View>
  );
}

const CONFIRM_MS = 4000;

/** Resets on the second press: the first one turns the button red and asks again for a few seconds. */
export function ResetTabButton({ theme, compact, onReset }: { theme: PluginTheme; compact: boolean; onReset(): void }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // React Native's typings take a number only, so the handle is checked first.
  const stop = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
  };
  useEffect(() => stop, []);
  const press = () => {
    stop();
    if (armed) {
      setArmed(false);
      onReset();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), CONFIRM_MS);
  };
  const color = armed ? theme.colors.statusDanger : theme.colors.foreground;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={armed ? "Press again to reset this tab's settings to their defaults." : undefined}
      onPress={press}
      style={{
        alignSelf: "flex-start",
        minHeight: compact ? 44 : 34,
        paddingHorizontal: 16,
        borderRadius: 8,
        justifyContent: "center",
        borderWidth: 1,
        borderColor: armed ? theme.colors.statusDanger : theme.colors.border,
      }}
    >
      <Text style={{ color, fontWeight: armed ? "600" : "400" }}>{armed ? "Press again to reset" : "Reset this tab"}</Text>
    </Pressable>
  );
}
