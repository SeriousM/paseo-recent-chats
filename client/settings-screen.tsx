import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import type { RowToken } from "../shared/layout";
import type { Prefs } from "../shared/settings";
import { LayoutEditor, LayoutPreview, TooltipPreview } from "./layout-editor";
import { ProjectsPreview } from "./projects-view";
import { BOTH_VIEWS, presetOptions, SectionEditor } from "./section-editor";
import { Slider } from "./slider";
import { sameLayout } from "./row-layout";
import { useRecents } from "./use-recents";
import { updateViewMode, useViewMode } from "./view-mode";
import type { UpdateCheck } from "./store";
import { copyText } from "./row-menu";

/** The browser's navigator where there is one (desktop and web); undefined on phones. */
declare const navigator: { userAgent: string; clipboard?: { writeText(text: string): Promise<void> } } | undefined;

/** The Projects tree's switches, in the order they are shown. */
const PROJECT_SWITCHES: readonly [keyof Prefs["projectsShow"], string, string][] = [
  ["branch", "Branch", "The git branch under each workspace."],
  ["mainBranch", "Also main and master", "Off: the branch is shown only when it is not main or master."],
  ["kind", "Checkout or worktree", "The small tag after the workspace name."],
  ["diff", "Line changes", "+added \u2212removed of the workspace."],
  ["hostTag", "Host tag on projects", "Only when projects are not grouped by host."],
  ["age", "Age of each chat", "How long ago, placed as in the row layout."],
  ["agent", "Agent of each chat", "The harness and model the chat runs on, placed as in the row layout."],
];

const VIEW_OPTIONS = [
  { label: "Automatic (Projects on wide screens, Triage on phones)", value: "auto" },
  { label: "Projects", value: "projects" },
  { label: "Triage", value: "triage" },
] as const;

/**
 * Settings, most used first: version and updates, this device's view, the row layout both views share,
 * settings both views use, then each view with its own preview, and the rest.
 */
export function SettingsScreen({ theme, layout: screen }: PluginSurfaceProps) {
  const { store, snapshot } = useRecents();
  const { prefs, hosts } = snapshot;
  const mode = useViewMode();
  const compact = screen.compact;
  const padding = compact ? 12 : 20;
  const change = (patch: Partial<Prefs>) => store.updatePrefs(patch);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  // The row layout is edited as a draft: both previews follow every change, but nothing is saved
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
  const [diagnostics, setDiagnostics] = useState<string | null>(null);
  const [copied, setCopied] = useState<"copied" | "failed" | null>(null);
  const makeDiagnostics = () => {
    const report = JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        device: {
          platform: Platform.OS,
          userAgent: typeof navigator === "undefined" ? null : navigator.userAgent,
          compact,
          viewMode: { ...mode, toggled: mode.toggled.length, legacyPins: mode.legacyPins.length },
        },
        ...store.diagnostics(),
      },
      null,
      2,
    );
    setDiagnostics(report);
    setCopied(null);
    const clipboard = typeof navigator === "undefined" ? undefined : navigator?.clipboard;
    const copy = copyText ?? (clipboard ? (text: string) => clipboard.writeText(text) : null);
    if (copy) void copy(report).then(() => setCopied("copied"), () => setCopied("failed"));
  };
  const where = snapshot.storageHosts.length
    ? `Settings, pins and read marks are saved on every connected host that runs Recent Chats (${snapshot.storageHosts.join(", ")}), so every device shows the same. Pins and read marks of a chat are kept on that chat's host.`
    : "Connecting to the hosts that keep these settings.";
  const outdatedNote = snapshot.outdatedHosts.length
    ? `${snapshot.outdatedHosts.join(", ")} ${snapshot.outdatedHosts.length === 1 ? "runs" : "run"} an older Recent Chats and keeps its previous settings until it has updated. It was asked to update now.`
    : null;
  const latest = prefs.latestVersion;
  const button = (primary: boolean, enabled: boolean) => ({
    alignSelf: "flex-start" as const,
    minHeight: compact ? 44 : 34,
    paddingHorizontal: 16,
    borderRadius: 8,
    justifyContent: "center" as const,
    ...(primary ? { backgroundColor: theme.colors.accent } : { borderWidth: 1, borderColor: theme.colors.border }),
    opacity: enabled ? 1 : 0.4,
  });
  const numberSelect = (setting: (typeof BOTH_VIEWS)[number]) => (
    <SettingsSelect
      key={setting.key}
      label={setting.label}
      hint={setting.hint}
      value={String(prefs[setting.key])}
      options={presetOptions(setting.presets, prefs[setting.key], setting.unit)}
      onValueChange={(next) => change({ [setting.key]: Number(next) })}
    />
  );

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors.surface0 }} contentContainerStyle={{ padding, gap: 16 }}>
      {outdatedNote ? <Text style={muted}>{outdatedNote}</Text> : null}
      {snapshot.errors
        .filter((error) => error.startsWith("Settings:"))
        .map((error) => (
          <Text key={error} style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
            {error}
          </Text>
        ))}

      <SettingsSection title="Version">
        <SettingsCard>
          <View style={{ padding: 12, gap: 8 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>
              {latest
                ? `Recent Chats ${latest.commit.slice(0, 7)}, installed ${new Date(latest.installedAt).toLocaleString()}`
                : "Recent Chats"}
            </Text>
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
              style={button(false, !checking)}
            >
              <Text style={{ color: theme.colors.foreground }}>{checking ? "Checking\u2026" : "Check now"}</Text>
            </Pressable>
            <Text style={muted}>
              Asks every connected host that runs Recent Chats. A host that finds a newer version installs it and reloads the
              plugin; this screen may reload with it.
            </Text>
            {updateResults?.length === 0 ? <Text style={muted}>No host answered.</Text> : null}
            {updateResults?.map((entry) => (
              <Text key={entry.host} style={{ color: entry.failed ? theme.colors.statusDanger : theme.colors.foreground, fontSize: 12 }}>
                {`${entry.host}: ${entry.result}`}
              </Text>
            ))}
          </View>
          <SettingsSwitch
            label="Keep Recent Chats up to date"
            hint="Every host that installed it from GitHub checks a few minutes after it starts and every 6 hours, and installs a newer version. Hosts that run it from a local folder are left alone."
            value={prefs.autoUpdate}
            onValueChange={(next) => change({ autoUpdate: next })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="This device">
        <SettingsCard>
          <SettingsSelect
            label="View"
            hint="Which list the sidebar shows on this device. Also switched in the sidebar's first row. Not synced."
            value={mode.view ?? "auto"}
            options={VIEW_OPTIONS}
            onValueChange={(next) => updateViewMode({ view: next === "auto" ? null : next })}
          />
          <SettingsSwitch
            label={`Projects: only the last ${prefs.inactiveWindowDays} days`}
            hint="Hides workspaces with nothing newer than the inactive window (below). Pinned ones stay. Same as the filter above the tree. Not synced."
            value={mode.activeOnly}
            onValueChange={(next) => updateViewMode({ activeOnly: next })}
          />
          <SettingsSwitch
            label="Projects: show empty workspaces and projects"
            hint="Also lists workspaces without chats and projects without workspaces. Same as the Empty filter above the tree. Not synced."
            value={mode.showEmpty === true}
            onValueChange={(next) => updateViewMode({ showEmpty: next })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Row layout">
        <Text style={muted}>One layout for the chat rows of both views; the previews below follow every edit.</Text>
        <LayoutPreview theme={theme} compact={compact} layout={draft} groupByHost={prefs.groupByHost} />
        <SettingsCard>
          <LayoutEditor theme={theme} compact={compact} layout={draft} onChange={setDraft} />
        </SettingsCard>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save row layout"
            accessibilityState={{ disabled: !dirty }}
            disabled={!dirty}
            onPress={() => change({ layout: draft })}
            style={button(true, dirty)}
          >
            <Text style={{ color: theme.colors.accentForeground, fontWeight: "600" }}>Save layout</Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Discard layout changes"
            accessibilityState={{ disabled: !dirty }}
            disabled={!dirty}
            onPress={() => setDraft([...prefs.layout])}
            style={button(false, dirty)}
          >
            <Text style={{ color: theme.colors.foreground }}>Discard</Text>
          </Pressable>
          <Text style={{ color: dirty ? theme.colors.statusWarning : theme.colors.foregroundMuted, fontSize: 12 }}>
            {dirty ? "Unsaved changes. The lists keep the saved layout until you save." : "Saved."}
          </Text>
        </View>
      </SettingsSection>

      <SettingsSection title="Both views">
        <SettingsCard>{BOTH_VIEWS.map(numberSelect)}</SettingsCard>
      </SettingsSection>

      <SettingsSection title="Projects view">
        <ProjectsPreview theme={theme} compact={compact} prefs={prefs} layout={draft} />
        <SettingsCard>
          <SettingsSwitch
            label="Group by host"
            hint="A heading per host above its projects. Off: one list of projects, each with its host's tag. Also in the Hosts dropdown."
            value={prefs.projectsGroupByHost}
            onValueChange={(next) => change({ projectsGroupByHost: next })}
          />
          {numberSelect({
            key: "chatsPerWorkspace",
            label: "Chats per workspace",
            hint: "The rest fold into \u201C+N older\u201D. Chats that need you, run or are pinned always show.",
            presets: [1, 2, 3, 4, 5, 8, 10],
          })}
          {numberSelect({
            key: "staleDays",
            label: "Stale after",
            hint: "The \u201CStale\u201D cleanup filter above the tree lists chats with nothing newer than this, to archive them.",
            presets: [14, 30, 60, 90, 180, 365],
            unit: " days",
          })}
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

      <SettingsSection title="Triage view">
        <SettingsCard>
          <SettingsSwitch
            label="Group rows by host"
            hint="One heading per host. Chats are limited per host, and the host tag is left out of the rows. The row layout preview shows it."
            value={prefs.groupByHost}
            onValueChange={(next) => change({ groupByHost: next })}
          />
          <SettingsSwitch
            label="Section headings"
            hint="Pinned, Needs you, Running, Inactive."
            value={prefs.groupHeadings}
            onValueChange={(next) => change({ groupHeadings: next })}
          />
        </SettingsCard>
        <SettingsCard>
          <SectionEditor theme={theme} compact={compact} prefs={prefs} onChange={change} />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Hosts">
        <SettingsCard>
          {hosts.length < 2 ? (
            <View style={{ padding: 12 }}>
              <Text style={muted}>
                Only one host is connected. Connect another host to choose which hosts are listed. Hosts that are not connected are not shown.
              </Text>
            </View>
          ) : (
            hosts.map((entry) => (
              <SettingsSwitch
                key={entry.id}
                label={`List chats of ${entry.label}`}
                hint="Connected. Both views; also in the Hosts dropdown."
                value={!entry.hidden}
                onValueChange={() => store.toggleHost(entry.id)}
              />
            ))
          )}
        </SettingsCard>
        <Text style={muted}>{where}</Text>
      </SettingsSection>

      <SettingsSection title="Sidebar list">
        <SettingsCard>
          <SettingsSwitch
            label="Sidebar list expanded"
            hint="Also changes when you open or close the list in the sidebar."
            value={prefs.sidebarExpanded}
            onValueChange={(next) => change({ sidebarExpanded: next })}
          />
          {(["sidebarHeightPhone", "sidebarHeightDesktop"] as const).map((key) => (
            <View key={key} style={{ padding: 12, gap: 8 }}>
              <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>
                {key === "sidebarHeightPhone" ? "Height on phones" : "Height on wide screens"}
              </Text>
              <Text style={muted}>Share of the window height the list takes, even when fewer chats would fit. The grip under the list sets it too.</Text>
              <Slider
                theme={theme}
                compact={compact}
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
            hint="A card with the untruncated names after the pointer rests on a row (long press on touch)."
            value={prefs.showTooltip}
            onValueChange={(next) => change({ showTooltip: next })}
          />
          <View style={{ padding: 12, gap: 8, opacity: prefs.showTooltip ? 1 : 0.5 }}>
            <Text style={{ color: theme.colors.foreground, fontSize: 14 }}>Card transparency</Text>
            <Slider
              theme={theme}
              compact={compact}
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
            hint="Counts and the chat list inside every chat. Also tells the plugin which chat is open (highlight, back and forward)."
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

      <SettingsSection title="Diagnostics">
        <SettingsCard>
          <View style={{ padding: 12, gap: 8 }}>
            <Text style={muted}>
              When the list stays empty or shows something wrong: create a report, then send it to whoever helps you. It lists
              hosts, their status, chat counts, settings and errors. No chat titles, messages or folder paths.
            </Text>
            <Pressable accessibilityRole="button" onPress={makeDiagnostics} style={button(false, true)}>
              <Text style={{ color: theme.colors.foreground }}>Create diagnostics report</Text>
            </Pressable>
            {copied === "copied" ? <Text style={muted}>Copied to the clipboard. It is also below.</Text> : null}
            {copied === "failed" ? <Text style={muted}>Could not copy. Select the text below and copy it.</Text> : null}
            {diagnostics ? (
              <TextInput
                value={diagnostics}
                editable={false}
                multiline
                selectTextOnFocus
                style={{
                  minHeight: 160,
                  maxHeight: 320,
                  padding: 8,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: theme.colors.border,
                  backgroundColor: theme.colors.surface1,
                  color: theme.colors.foreground,
                  fontFamily: Platform.OS === "web" ? "monospace" : undefined,
                  fontSize: 11,
                }}
              />
            ) : null}
          </View>
        </SettingsCard>
      </SettingsSection>
    </ScrollView>
  );
}
