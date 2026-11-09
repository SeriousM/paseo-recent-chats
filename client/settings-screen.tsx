import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RowToken } from "../shared/layout";
import type { Prefs } from "../shared/settings";
import { LayoutEditor, LayoutPreview, TooltipPreview } from "./layout-editor";
import { Slider } from "./slider";
import { sameLayout } from "./row-layout";
import { useRecents } from "./use-recents";

type NumericPref = "maxUnread" | "maxRunning" | "maxInactive" | "inactiveWindowDays" | "unreadExpiryDays";

/** Preset choices keep the screen usable on a phone and make invalid input impossible. */
function options(presets: readonly number[], current: number, unit = "") {
  const values = presets.includes(current) ? presets : [...presets, current].sort((a, b) => a - b);
  return values.map((value) => ({ label: `${value}${unit}`, value: String(value) }));
}

export function SettingsScreen({ theme, layout: screen, host }: PluginSurfaceProps) {
  const { store, snapshot } = useRecents();
  const { prefs, hosts } = snapshot;
  const padding = screen.compact ? 12 : 20;
  const change = (patch: Partial<Prefs>) => store.updatePrefs(patch);

  // The row layout is edited as a draft: the preview follows every change, but nothing is saved
  // until Save is pressed. A layout saved elsewhere replaces the draft only while it has no edits.
  const [draft, setDraft] = useState<RowToken[]>(() => [...prefs.layout]);
  const savedLayout = useRef(prefs.layout);
  const dirty = !sameLayout(draft, prefs.layout);
  useEffect(() => {
    if (savedLayout.current !== prefs.layout) {
      const wasClean = sameLayout(draft, savedLayout.current);
      savedLayout.current = prefs.layout;
      if (wasClean) setDraft([...prefs.layout]);
    }
  }, [prefs.layout, draft]);
  const numeric = (key: NumericPref, label: string, hint: string, presets: readonly number[], unit?: string) => (
    <SettingsSelect
      label={label}
      hint={hint}
      value={String(prefs[key])}
      options={options(presets, prefs[key], unit)}
      onValueChange={(next) => change({ [key]: Number(next) })}
    />
  );
  const where =
    snapshot.prefsStorage === "device"
      ? "These settings are saved on this device. Other devices keep their own, and every host shows the same view here."
      : `This device cannot save settings itself, so they are saved on ${host.label}. Desktop and web keep their own.`;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding, gap: 16 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{where}</Text>
      {snapshot.errors
        .filter((error) => error.startsWith("Settings:"))
        .map((error) => (
          <Text key={error} style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
            {error}
          </Text>
        ))}
      <SettingsSection title="Row layout">
        <LayoutPreview theme={theme} compact={screen.compact} layout={draft} groupByHost={prefs.groupByHost} />
        <SettingsCard>
          <LayoutEditor theme={theme} compact={screen.compact} layout={draft} onChange={setDraft} />
        </SettingsCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save row layout"
            accessibilityState={{ disabled: !dirty }}
            disabled={!dirty}
            onPress={() => change({ layout: draft })}
            style={{
              minHeight: screen.compact ? 44 : 34,
              paddingHorizontal: 16,
              borderRadius: 8,
              justifyContent: "center",
              backgroundColor: theme.colors.accent,
              opacity: dirty ? 1 : 0.4,
            }}
          >
            <Text style={{ color: theme.colors.accentForeground, fontWeight: "600" }}>Save layout</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard layout changes"
            accessibilityState={{ disabled: !dirty }}
            disabled={!dirty}
            onPress={() => setDraft([...prefs.layout])}
            style={{
              minHeight: screen.compact ? 44 : 34,
              paddingHorizontal: 14,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: theme.colors.border,
              justifyContent: "center",
              opacity: dirty ? 1 : 0.4,
            }}
          >
            <Text style={{ color: theme.colors.foreground }}>Discard</Text>
          </Pressable>
          <Text style={{ color: dirty ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 12 }}>
            {dirty ? "Unsaved changes. The lists keep the saved layout until you save." : "Saved."}
          </Text>
        </View>
      </SettingsSection>
      <SettingsSection title="Hosts">
        <SettingsCard>
          <SettingsSwitch
            label="Group rows by host"
            hint="One heading per host. Chats are limited per host, and the host tag is left out of the rows."
            value={prefs.groupByHost}
            onValueChange={(next) => change({ groupByHost: next })}
          />
          {hosts.length < 2 ? (
            <View style={{ padding: 12 }}>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                Only one host is connected. Connect another host to choose which hosts are listed. Hosts that are not connected are not shown.
              </Text>
            </View>
          ) : (
            hosts.map((entry) => (
              <SettingsSwitch
                key={entry.id}
                label={`List chats of ${entry.label}`}
                hint="Connected."
                value={!entry.hidden}
                onValueChange={() => store.toggleHost(entry.id)}
              />
            ))
          )}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="List size">
        <SettingsCard>
          {numeric("maxUnread", "Unread chats shown", "Oldest first. The rest appear as a +N chip. Per host when grouped.", [3, 4, 5, 6, 8, 10, 15, 20])}
          {numeric("maxRunning", "Running chats shown", "Oldest first. 0 hides them (the +N chip still counts them).", [0, 1, 2, 3, 4, 5, 8, 10])}
          {numeric("maxInactive", "Inactive chats shown", "Most recent first. 0 hides them.", [0, 2, 3, 4, 5, 8, 10, 15])}
          {numeric("inactiveWindowDays", "Inactive window", "Chats older than this stay out of the short list.", [3, 7, 14, 30, 90], " days")}
          {numeric("unreadExpiryDays", "Unread expiry", "Unread chats waiting longer count as inactive.", [1, 3, 7, 14, 30], " days")}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Display">
        <SettingsCard>
          <SettingsSwitch
            label="Group headings"
            hint="Needs you, Running, Inactive."
            value={prefs.groupHeadings}
            onValueChange={(next) => change({ groupHeadings: next })}
          />
          <SettingsSwitch
            label="Sidebar list expanded"
            hint="Initial state of the sidebar list."
            value={prefs.sidebarExpanded}
            onValueChange={(next) => change({ sidebarExpanded: next })}
          />
          {(["sidebarHeightPhone", "sidebarHeightDesktop"] as const).map((key) => (
            <View key={key} style={{ padding: 12, gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>
                {key === "sidebarHeightPhone" ? "Sidebar list height on phones" : "Sidebar list height on wide screens"}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                Most of the window height the list may take. The grip under the list sets it too.
              </Text>
              <Slider
                theme={theme}
                compact={screen.compact}
                label={key === "sidebarHeightPhone" ? "phone sidebar list height" : "wide sidebar list height"}
                value={prefs[key]}
                min={15}
                max={85}
                step={5}
                display={`${prefs[key]}%`}
                onChange={(next) => change({ [key]: next })}
              />
            </View>
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Full names card">
        <SettingsCard>
          <SettingsSwitch
            label="Show full names on hover"
            hint="A card with the untruncated names while the pointer rests on a row (long press on touch)."
            value={prefs.showTooltip}
            onValueChange={(next) => change({ showTooltip: next })}
          />
          <View style={{ padding: 12, gap: 8, opacity: prefs.showTooltip ? 1 : 0.5 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>Card transparency</Text>
            <Slider
              theme={theme}
              compact={screen.compact}
              label="card transparency"
              value={prefs.tooltipTransparency}
              min={0}
              max={90}
              step={5}
              display={`${prefs.tooltipTransparency}%`}
              onChange={(next) => change({ tooltipTransparency: next })}
            />
            <TooltipPreview theme={theme} transparency={prefs.tooltipTransparency} />
          </View>
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Composer pills">
        <SettingsCard>
          <SettingsSwitch
            label="Inbox pill"
            hint="Counts and the chat list inside every chat."
            value={prefs.showInboxPill}
            onValueChange={(next) => change({ showInboxPill: next })}
          />
          <SettingsSwitch
            label="Later pill"
            hint="Marks the current chat unread."
            value={prefs.showLaterPill}
            onValueChange={(next) => change({ showLaterPill: next })}
          />
          <SettingsSelect
            label="After Later"
            hint="Open the next chat, or stay on this one."
            value={prefs.laterBehavior}
            options={[
              { label: "Open the next chat", value: "jump" },
              { label: "Stay on this chat", value: "stay" },
            ]}
            onValueChange={(next) => change({ laterBehavior: next })}
          />
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
