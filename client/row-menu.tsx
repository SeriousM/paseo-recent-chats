// The ⋮ menu of a chat, workspace or project row, like the ones in Paseo's own sidebar: a button at the
// end of the row (always shown), right-click and long press.
// On wide screens it opens as a small menu under the button; on phones as Paseo's own sheet.
import type { PluginTheme } from "@getpaseo/plugin";
import * as pluginUi from "@getpaseo/plugin/client/ui";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { useFontScale } from "./font-scale";
import { onDismiss } from "./web";

export interface MenuItem {
  label: string;
  /** Lucide icon name. */
  icon: string;
  onPress(): void | Promise<void>;
  /** Shown in red, like Paseo's archive items. */
  danger?: boolean;
  /** Small text at the right end. */
  hint?: string;
  /** Asked before running, with Cancel and the item's label as the buttons. */
  confirm?: string;
}

/** Items in groups; a line separates the groups. Empty groups are left out. */
export type MenuGroups = readonly (readonly (MenuItem | null | false)[])[];

/** Copies text where the app offers it (Paseo 0.16's plugin kit); null where it does not. */
export const copyText: ((text: string) => Promise<void>) | null =
  "copyText" in pluginUi && typeof pluginUi.copyText === "function" ? pluginUi.copyText : null;

/** Reports a failed action the way Paseo does (a toast) where the app offers it. */
const useToast: () => { error(message: string): void } =
  "useToast" in pluginUi && typeof pluginUi.useToast === "function" ? pluginUi.useToast : () => ({ error: (message) => console.error(message) });

/** Paseo's modal, a sheet on phones, where the app offers it. */
const SheetModal: typeof pluginUi.Modal | undefined = "Modal" in pluginUi ? (pluginUi.Modal as typeof pluginUi.Modal | undefined) : undefined;

/** The vertical three-dot button at the end of a row. Keeps its space while hidden, so rows do not shift. */
export function MenuButton({
  theme,
  compact,
  label,
  onOpen,
  nodeRef,
}: {
  theme: PluginTheme;
  compact: boolean;
  label: string;
  onOpen(): void;
  nodeRef?: (node: View | null) => void;
}) {
  const size = compact ? 32 : 20;
  return (
    <Pressable
      ref={nodeRef}
      accessibilityRole="button"
      accessibilityLabel={`${label} actions`}
      onPress={onOpen}
      hitSlop={6}
      style={({ pressed }) => ({
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 6,
        opacity: pressed ? 0.6 : 1,
        backgroundColor: pressed ? theme.colors.surface2 : "transparent",
      })}
    >
      <Icon name="EllipsisVertical" size={14} color={theme.colors.foregroundMuted} />
    </Pressable>
  );
}

/** The open menu: its items, or a confirmation for an item that asks first. */
export function MenuView({
  theme,
  compact,
  title,
  groups,
  onClose,
}: {
  theme: PluginTheme;
  compact: boolean;
  title: string;
  groups: MenuGroups;
  onClose(): void;
}) {
  const fs = useFontScale();
  const toast = useToast();
  const [confirming, setConfirming] = useState<MenuItem | null>(null);
  const node = useRef<View>(null);
  useEffect(() => onDismiss(node.current, onClose), [onClose]);
  const run = (item: MenuItem) => {
    onClose();
    void Promise.resolve()
      .then(() => item.onPress())
      .catch((error: unknown) => toast.error(`${item.label} failed: ${error instanceof Error ? error.message : String(error)}`));
  };
  const visible = groups.map((group) => group.filter((item): item is MenuItem => Boolean(item))).filter((group) => group.length > 0);
  const row = (item: MenuItem, onPress: () => void) => (
    <Pressable
      key={item.label}
      accessibilityRole="menuitem"
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        minHeight: compact ? 44 : 30,
        borderRadius: 6,
        backgroundColor: pressed || hovered ? theme.colors.surface1 : "transparent",
      })}
    >
      <Icon name={item.icon} size={14} color={item.danger ? theme.colors.statusDanger : theme.colors.foregroundMuted} />
      <Text style={{ flex: 1, fontSize: fs(13), color: item.danger ? theme.colors.statusDanger : theme.colors.foreground }}>{item.label}</Text>
      {item.hint ? <Text style={{ fontSize: fs(11), color: theme.colors.foregroundMuted }}>{item.hint}</Text> : null}
    </Pressable>
  );
  const body: ReactNode = confirming ? (
    <View style={{ gap: 8, padding: 6 }}>
      <Text style={{ fontSize: fs(13), color: theme.colors.foreground }}>{confirming.confirm}</Text>
      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 6 }}>
        {row({ label: "Cancel", icon: "X", onPress: onClose }, onClose)}
        {row(confirming, () => run(confirming))}
      </View>
    </View>
  ) : (
    visible.map((group, index) => (
      <View key={index} style={index > 0 ? { borderTopWidth: 1, borderTopColor: theme.colors.border, marginTop: 4, paddingTop: 4 } : null}>
        {group.map((item) => row(item, () => (item.confirm ? setConfirming(item) : run(item))))}
      </View>
    ))
  );
  // Phones: Paseo's own sheet, as its sidebar does.
  if (compact && SheetModal) {
    const Modal = SheetModal;
    return (
      <Modal title={title} open onOpenChange={(open) => (open ? undefined : onClose())}>
        <Modal.Content contentContainerStyle={{ padding: 8, gap: 0 }}>{body}</Modal.Content>
      </Modal>
    );
  }
  return (
    <View
      ref={node}
      accessibilityRole="menu"
      style={{
        width: 240,
        padding: 4,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface2,
        shadowColor: "#000",
        shadowOpacity: 0.35,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 6 },
        elevation: 8,
      }}
    >
      {body}
    </View>
  );
}
