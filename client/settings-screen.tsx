import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import type { RowToken } from "../shared/layout";
import type { Prefs } from "../shared/settings";
import { LayoutEditor, LayoutPreview, TooltipPreview } from "./layout-editor";
import { SectionEditor } from "./section-editor";
import { Slider } from "./slider";
import { sameLayout } from "./row-layout";
import { useRecents } from "./use-recents";
import type { UpdateCheck } from "./store";

/** The Projects tree's switches, in the order they are shown. */
const PROJECT_SWITCHES: readonly [keyof Prefs["projectsShow"], string, string][] = [
  ["branch", "Branch", "The git branch under each workspace."],
  ["mainBranch", "Also main and master", "Off: the branch is shown only when it is not main or master."],
  ["kind", "Checkout or worktree", "The small tag after the workspace name."],
  ["diff", "Line changes", "+added \u2212removed of the workspace."],
  ["hostTag", "Host tag on projects", "Only when projects are not grouped by host."],
  ["age", "Age of each chat", "How long ago, placed as in the row layout."],
  ["agent", "Agent of each chat", "The model the chat runs on, placed as in the row layout."],
];

export function SettingsScreen({ theme, layout: screen }: PluginSurfaceProps) {
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
  const [checking, setChecking] = useState(false);
  const [updateResults, setUpdateResults] = useState<UpdateCheck[] | null>(null);
  const where = snapshot.storageHosts.length
    ? `These settings, pins and read marks are saved on every connected host that runs Recent Chats (${snapshot.storageHosts.join(", ")}), so every device shows the same view. Pins and read marks of a chat are kept on that chat's host.`
    : "Connecting to the hosts that keep these settings.";
  const outdatedNote = snapshot.outdatedHosts.length
    ? `${snapshot.outdatedHosts.join(", ")} ${snapshot.outdatedHosts.length === 1 ? "runs" : "run"} an older Recent Chats and keeps its previous settings until it has updated. It was asked to update now.`
    : null;

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding, gap: 16 }}>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{where}</Text>
      {outdatedNote ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>{outdatedNote}</Text> : null}
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
      <SettingsSection title="Sections">
        <SettingsCard>
          <SectionEditor theme={theme} compact={screen.compact} prefs={prefs} onChange={change} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Projects view">
        <SettingsCard>
          {PROJECT_SWITCHES.map(([key, label, hint]) => (
            <SettingsSwitch
              key={key}
              label={label}
              hint={hint}
              value={prefs.projectsShow[key]}
              disabled={key === "mainBranch" && !prefs.projectsShow.branch}
              onValueChange={(next) => change({ projectsShow: { ...prefs.projectsShow, [key]: next } })}
            />
          ))}
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
            hint="Also changes when you open or close the list in the sidebar."
            value={prefs.sidebarExpanded}
            onValueChange={(next) => change({ sidebarExpanded: next })}
          />
          {(["sidebarHeightPhone", "sidebarHeightDesktop"] as const).map((key) => (
            <View key={key} style={{ padding: 12, gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>
                {key === "sidebarHeightPhone" ? "Sidebar list height on phones" : "Sidebar list height on wide screens"}
              </Text>
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
                Share of the window height the list takes, even when fewer chats would fit. The grip under the list sets it too.
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
      <SettingsSection title="Updates">
        <SettingsCard>
          <SettingsSwitch
            label="Keep Recent Chats up to date"
            hint="Every host that installed it from GitHub checks for a newer version a few minutes after it starts and every 6 hours, and installs it. Hosts that run it from a local folder are left alone."
            value={prefs.autoUpdate}
            onValueChange={(next) => change({ autoUpdate: next })}
          />
          <View style={{ padding: 12, gap: 8 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ busy: checking }}
              disabled={checking}
              onPress={() => {
                setChecking(true);
                setUpdateResults(null);
                void store
                  .checkForUpdates()
                  .then(setUpdateResults)
                  .finally(() => setChecking(false));
              }}
              style={{
                alignSelf: "flex-start",
                minHeight: screen.compact ? 44 : 34,
                paddingHorizontal: 16,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.colors.border,
                justifyContent: "center",
                opacity: checking ? 0.5 : 1,
              }}
            >
              <Text style={{ color: theme.colors.foreground }}>{checking ? "Checking\u2026" : "Check now"}</Text>
            </Pressable>
            <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>
              Checks every connected host that runs Recent Chats, whether or not the switch above is on. A host that
              finds a newer version installs it and reloads the plugin; this screen may reload with it.
            </Text>
            {updateResults?.length === 0 ? (
              <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12 }}>No host answered.</Text>
            ) : null}
            {updateResults?.map((entry) => (
              <Text
                key={entry.host}
                style={{ color: entry.failed ? theme.colors.statusDanger : theme.colors.foreground, fontSize: 12 }}
              >
                {`${entry.host}: ${entry.result}`}
              </Text>
            ))}
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
