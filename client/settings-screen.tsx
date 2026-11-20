import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsSection, SettingsSelect, SettingsSwitch } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from "react-native";
import type { RowToken } from "../shared/layout";
import { pillsInOrder, type PillId, type Prefs } from "../shared/settings";
import { IconButton, LayoutEditor, LayoutPreview, TooltipPreview } from "./layout-editor";
import { DEFAULT_PREFS } from "./prefs";
import { ProjectsPreview } from "./projects-view";
import { BOTH_VIEWS, presetOptions, SectionEditor } from "./section-editor";
import { Dimmed, ResetTabButton, Segmented, TabBar } from "./settings-tabs";
import { Slider } from "./slider";
import { sameLayout } from "./row-layout";
import { useRecents } from "./use-recents";
import { updateViewMode, useViewMode } from "./view-mode";
import type { UpdateCheck } from "./store";
import { copyText } from "./row-menu";
import { PHONE_ROW_ONLY } from "./sidebar-item";
import { clipboardWriter, readUserAgent } from "./web";

/** Each composer pill's switch in the settings. */
const PILL_SETTINGS: Record<PillId, { label: string; hint: string; key: "showInboxPill" | "showLaterPill" | "showHostPill" }> = {
  inbox: {
    label: "Inbox pill",
    hint: "Counts and the chat list inside every chat. Also tells the plugin which chat is open (highlight, back and forward).",
    key: "showInboxPill",
  },
  later: { label: "Later pill", hint: "Marks the current chat unread.", key: "showLaterPill" },
  host: { label: "Host pill", hint: "The host the chat runs on, in the colour you gave it in Paseo. A press jumps to your previous message (desktop and web).", key: "showHostPill" },
};

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

type TabId = "list" | "projects" | "sidebar" | "version";

const TABS: readonly { id: TabId; label: string }[] = [
  { id: "list", label: "List" },
  { id: "projects", label: "Projects" },
  { id: "sidebar", label: "Sidebar & pills" },
  { id: "version", label: "Version & help" },
];

/**
 * The prefs each tab's reset puts back to their defaults. Hidden hosts, pins, dragged orders, the
 * installed version and whether the sidebar list is open are left alone: they are not choices on a tab.
 */
const RESET_KEYS: Record<Exclude<TabId, "version">, readonly (keyof Prefs)[]> = {
  list: [
    "layout",
    "maxUnread",
    "unreadExpiryDays",
    "inactiveWindowDays",
    "groupByHost",
    "groupHeadings",
    "sectionOrder",
    "sectionSort",
    "showTooltip",
    "tooltipTransparency",
  ],
  projects: ["projectsGroupByHost", "chatsPerWorkspace", "staleDays", "projectsShow"],
  sidebar: ["sidebarHeightPhone", "sidebarHeightDesktop", "showInboxPill", "showLaterPill", "showHostPill", "pillOrder", "laterBehavior"],
};

/** Window width from which the List and Projects tabs put their preview beside the options. */
const TWO_COLUMNS_FROM = 900;
/** Width the preview is drawn at when it shows a phone. */
const PHONE_PREVIEW_WIDTH = 360;

type PreviewDevice = "desktop" | "phone";

// Kept outside the component so the chosen tab and preview device survive the screen being remounted.
let lastTab: TabId = "list";
let lastPreviewDevice: PreviewDevice | null = null;

/**
 * Settings in four tabs: the list rows and both views, the Projects view, the sidebar and composer
 * pills, and version and help. The List and Projects tabs keep one preview in view: beside the options
 * on wide windows, above them on narrow ones.
 */
export function SettingsScreen({ theme, layout: screen }: PluginSurfaceProps) {
  const { store, snapshot } = useRecents();
  const { prefs, hosts } = snapshot;
  const mode = useViewMode();
  const compact = screen.compact;
  const { width } = useWindowDimensions();
  const wide = !compact && width >= TWO_COLUMNS_FROM;
  const padding = compact ? 12 : 20;
  const change = (patch: Partial<Prefs>) => store.updatePrefs(patch);
  const muted = { color: theme.colors.foregroundMuted, fontSize: 12 };

  const [tab, setTabState] = useState<TabId>(lastTab);
  const setTab = (next: TabId) => {
    lastTab = next;
    setTabState(next);
  };
  const [device, setDeviceState] = useState<PreviewDevice>(lastPreviewDevice ?? (compact ? "phone" : "desktop"));
  const setDevice = (next: PreviewDevice) => {
    lastPreviewDevice = next;
    setDeviceState(next);
  };
  const previewCompact = device === "phone";

  // The row layout is edited as a draft: the previews follow every change, but nothing is saved
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
          userAgent: readUserAgent(),
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
    const copy = copyText ?? clipboardWriter();
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
  const resetButton = (keys: readonly (keyof Prefs)[], after?: () => void) => (
    <ResetTabButton
      theme={theme}
      compact={compact}
      onReset={() => {
        // Copied so the stored prefs never share arrays or objects with DEFAULT_PREFS.
        change(Object.fromEntries(keys.map((key) => [key, JSON.parse(JSON.stringify(DEFAULT_PREFS[key]))])) as Partial<Prefs>);
        after?.();
      }}
    />
  );

  const listOptions = (
    <>
      <SettingsSection title="Row layout">
        <Text style={muted}>One layout for the chat rows of both views; the preview follows every edit.</Text>
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

      <SettingsSection title="Triage view">
        <SettingsCard>
          <SettingsSwitch
            label="Group rows by host"
            hint="One heading per host. Chats are limited per host, and the host tag is left out of the rows. The preview shows it."
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

      <SettingsSection title="Full names card">
        <SettingsCard>
          <SettingsSwitch
            label="Show full names on hover"
            hint="A card with the untruncated names after the pointer rests on a row (long press on touch)."
            value={prefs.showTooltip}
            onValueChange={(next) => change({ showTooltip: next })}
          />
          <Dimmed off={!prefs.showTooltip}>
            <View style={{ padding: 12, gap: 8 }}>
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
            </View>
          </Dimmed>
        </SettingsCard>
      </SettingsSection>

      {resetButton(RESET_KEYS.list, () => setDraft([...DEFAULT_PREFS.layout]))}
    </>
  );

  const projectsOptions = (
    <>
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
            hint="Hides workspaces with nothing newer than the inactive window (List tab). Pinned ones stay. Same as the filter above the tree. Not synced."
            value={mode.activeOnly}
            onValueChange={(next) => updateViewMode({ activeOnly: next })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title="Projects view">
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
          {PROJECT_SWITCHES.map(([key, label, hint]) => {
            const off = (key === "mainBranch" && !prefs.projectsShow.branch) || (key === "hostTag" && prefs.projectsGroupByHost);
            return (
              <Dimmed key={key} off={off}>
                <SettingsSwitch
                  label={label}
                  hint={hint}
                  value={prefs.projectsShow[key]}
                  disabled={off}
                  onValueChange={(next) => change({ projectsShow: { ...prefs.projectsShow, [key]: next } })}
                />
              </Dimmed>
            );
          })}
        </SettingsCard>
      </SettingsSection>

      {resetButton(RESET_KEYS.projects)}
    </>
  );

  const sidebarOptions = (
    <>
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
      </SettingsSection>

      <SettingsSection title="Sidebar list">
        <SettingsCard>
          <SettingsSwitch
            label="Sidebar list expanded"
            hint="Also changes when you open or close the list in the sidebar."
            value={prefs.sidebarExpanded}
            onValueChange={(next) => change({ sidebarExpanded: next })}
          />
          {PHONE_ROW_ONLY ? (
            <Text style={[muted, { padding: 12 }]}>
              On phones the sidebar shows only the Recent Chats row, which opens the full list: Paseo gives the rows above its own
              list too little room. For the list in the drawer, choose Recent Chats under Paseo Settings, Sidebar, Sidebar view.
            </Text>
          ) : null}
          {(PHONE_ROW_ONLY ? (["sidebarHeightDesktop"] as const) : (["sidebarHeightPhone", "sidebarHeightDesktop"] as const)).map((key) => (
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

      <SettingsSection title="Composer pills">
        <SettingsCard>
          <Text style={[muted, { paddingHorizontal: 12, paddingTop: 12 }]}>
            Recent Chats' pills next to the composer, in this order; the arrows move one. Where they sit among the pills of Paseo
            and other plugins is up to Paseo.
          </Text>
          {pillsInOrder(prefs.pillOrder).map((pill, index, order) => {
            const move = (by: number) => {
              const next = [...order];
              next.splice(index, 1);
              next.splice(index + by, 0, pill);
              change({ pillOrder: next });
            };
            const { label, hint, key } = PILL_SETTINGS[pill];
            return (
              <View key={pill} style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingLeft: 8 }}>
                <IconButton theme={theme} compact={compact} label={`Move ${label} up`} icon="ChevronUp" disabled={index === 0} onPress={() => move(-1)} />
                <IconButton
                  theme={theme}
                  compact={compact}
                  label={`Move ${label} down`}
                  icon="ChevronDown"
                  disabled={index === order.length - 1}
                  onPress={() => move(1)}
                />
                <View style={{ flex: 1 }}>
                  <SettingsSwitch label={label} hint={hint} value={prefs[key]} onValueChange={(next) => change({ [key]: next })} />
                </View>
              </View>
            );
          })}
          <Dimmed off={!prefs.showLaterPill}>
            <SettingsSelect
              label="After Later"
              hint="Open the next chat, or stay on this one."
              value={prefs.laterBehavior}
              disabled={!prefs.showLaterPill}
              options={[
                { label: "Open the next chat", value: "jump" },
                { label: "Stay on this chat", value: "stay" },
              ]}
              onValueChange={(next) => change({ laterBehavior: next })}
            />
          </Dimmed>
        </SettingsCard>
      </SettingsSection>

      {resetButton(RESET_KEYS.sidebar)}
    </>
  );

  const versionOptions = (
    <>
      {outdatedNote ? <Text style={muted}>{outdatedNote}</Text> : null}
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

      <SettingsSection title="Where settings are kept">
        <Text style={muted}>{where}</Text>
      </SettingsSection>
    </>
  );

  const previewContent =
    tab === "list" ? (
      <>
        <LayoutPreview theme={theme} compact={previewCompact} layout={draft} groupByHost={prefs.groupByHost} />
        {prefs.showTooltip ? <TooltipPreview theme={theme} transparency={prefs.tooltipTransparency} /> : null}
      </>
    ) : tab === "projects" ? (
      <ProjectsPreview theme={theme} compact={previewCompact} prefs={prefs} layout={draft} />
    ) : null;
  const preview = previewContent ? (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <Segmented
          theme={theme}
          compact={compact}
          label="Preview size"
          options={[
            { id: "desktop", label: "Desktop" },
            { id: "phone", label: "Phone" },
          ]}
          value={device}
          onChange={setDevice}
        />
        <Text style={muted}>Preview: follows every change.</Text>
      </View>
      <View style={{ gap: 8, width: "100%", maxWidth: previewCompact ? PHONE_PREVIEW_WIDTH : undefined }}>{previewContent}</View>
    </View>
  ) : null;

  const options: Record<TabId, ReactNode> = {
    list: listOptions,
    projects: projectsOptions,
    sidebar: sidebarOptions,
    version: versionOptions,
  };
  const scrollGap = { padding, gap: 16 };

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.surface0 }}>
      <View style={{ paddingHorizontal: padding, paddingTop: padding, gap: 8 }}>
        {snapshot.errors
          .filter((error) => error.startsWith("Settings:"))
          .map((error) => (
            <Text key={error} style={{ color: theme.colors.statusDanger, fontSize: 12 }}>
              {error}
            </Text>
          ))}
        <TabBar theme={theme} compact={compact} tabs={TABS} value={tab} onChange={setTab} />
      </View>
      {wide && preview ? (
        <View style={{ flex: 1, flexDirection: "row" }}>
          <ScrollView key={tab} style={{ flex: 1 }} contentContainerStyle={scrollGap}>
            {options[tab]}
          </ScrollView>
          <ScrollView style={{ flexGrow: 0, flexShrink: 0, width: Math.min(480, Math.round(width * 0.42)) }} contentContainerStyle={scrollGap}>
            {preview}
          </ScrollView>
        </View>
      ) : (
        <ScrollView key={tab} style={{ flex: 1 }} contentContainerStyle={scrollGap}>
          {preview}
          {options[tab]}
        </ScrollView>
      )}
    </View>
  );
}
