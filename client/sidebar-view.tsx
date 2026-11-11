import type { PluginTheme } from "@getpaseo/plugin";
import {
  useAgents,
  useHosts,
  usePaseo,
  useSettings,
  useWorkspace,
  useWorkspaces,
  type PluginSidebarViewProps,
  type WorkspaceRef,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { searchRows } from "./fuzzy";
import { reportOpenChat, useOpenChat } from "./open-chat";
import { buildTree, needsYou, type TreeHost, type TreeProject, type TreeWorkspace } from "./project-tree";
import { columnChars, visibleLines } from "./row-layout";
import { openPluginSettings } from "./runtime";
import { SearchBox } from "./search-box";
import type { StoreSnapshot } from "./store";
import { chatKey, type TriageRow } from "./triage";
import { HostHeading, LedDot, TriageList, TriageRowView, type RowViewProps, type TriageListProps } from "./triage-list";
import { openChat, useRecents } from "./use-recents";
import { DEFAULT_VIEW_PREFS, viewSettings, type ViewPrefs } from "./view-settings";
import type { RowTokenId } from "../shared/layout";

export const SIDEBAR_VIEW_ID = "recent-chats";

/** Chats listed per workspace before "+N older"; chats that need you, run or are pinned always show. */
const CHATS_PER_WORKSPACE = 3;

/** The tree shows host, project, workspace and branch itself, so its rows leave them out. */
const TREE_HIDDEN: readonly RowTokenId[] = ["host", "project", "workspace", "branch"];

/** Row props that are the same for every chat row in the view. */
type RowShared = Omit<RowViewProps, "row" | "showHost" | "hostColor" | "lines" | "columns" | "current">;

/**
 * The whole sidebar between Paseo's header and footer. Projects mode: a Needs you strip above a
 * host -> project -> workspace -> chat tree. Triage mode: the sidebar list with its sections.
 */
export function RecentSidebarView({ theme, layout, active, navigation }: PluginSidebarViewProps) {
  const { store, snapshot, result } = useRecents();
  const compact = layout.compact;
  const view = useViewPrefs();
  const mode = view.prefs.mode ?? (compact ? "triage" : "projects");
  const [showSearch, setShowSearch] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const searching = showSearch && query.trim().length > 0;
  const matches = useMemo(() => (searching ? searchRows(query, result.all) : []), [searching, query, result]);

  // Paseo says which chat is open; it outranks the composer pills' guess (see open-chat.ts).
  const activeKey = active.agent ? chatKey(active.agent.hostId, active.agent.id) : null;
  useEffect(() => {
    if (!activeKey) return;
    const shown = reportOpenChat(activeKey);
    return () => shown.remove();
  }, [activeKey]);

  const agentRefs = useAgents();
  const agentByKey = useMemo(() => new Map(agentRefs.map((ref) => [chatKey(ref.hostId, ref.id), ref])), [agentRefs]);
  const open = (row: TriageRow) => {
    const ref = agentByKey.get(row.key);
    if (!ref) return;
    setQuery("");
    openChat(store, row, { navigation: { openAgent: () => navigation.openAgent(ref) } });
  };

  const rowShared: RowShared = {
    theme,
    compact,
    fullNames: snapshot.prefs.showTooltip,
    cardTransparency: snapshot.prefs.tooltipTransparency,
    onOpen: open,
    onMarkRead: store.markRead,
    onMarkUnread: store.markUnread,
    onSetPinned: store.setPinned,
    onRename: store.renameChat,
  };
  const listProps: TriageListProps = {
    theme,
    compact,
    onOpen: open,
    onMarkRead: store.markRead,
    onMarkUnread: store.markUnread,
    onSetPinned: store.setPinned,
    onRename: store.renameChat,
    result,
    snapshot,
    rows: searching ? matches : showAll ? result.all : undefined,
    onToggleHost: store.toggleHost,
    onToggleGroupByHost: () => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost }),
    onToggleSort: store.toggleSort,
    searching,
    onShowAll: showAll ? undefined : () => setShowAll(true),
  };

  return (
    <View style={{ flex: 1 }}>
      <TopBar
        theme={theme}
        compact={compact}
        mode={mode}
        onMode={(next) => view.change({ mode: next })}
        activeOnly={view.prefs.activeOnly}
        onActiveOnly={() => view.change({ activeOnly: !view.prefs.activeOnly })}
        searchOpen={showSearch}
        onSearch={() => {
          setShowSearch(!showSearch);
          setQuery("");
        }}
      />
      {showSearch ? (
        <View style={{ paddingHorizontal: 8, paddingBottom: 4 }}>
          <SearchBox theme={theme} compact={compact} value={query} onChange={setQuery} autoFocus />
        </View>
      ) : null}
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }}>
        {mode === "triage" || searching ? (
          <TriageList {...listProps} footer="none" />
        ) : (
          <ProjectsMode
            snapshot={snapshot}
            rows={result.all}
            rowShared={rowShared}
            activeOnly={view.prefs.activeOnly}
            toggled={view.toggled}
            onToggle={view.toggle}
            onOpenWorkspace={navigation.openWorkspace}
          />
        )}
      </ScrollView>
      {/* Outside the scroll area, so the chips, Mark all read and All chats stay at the bottom. */}
      {mode === "triage" && !searching ? <TriageList {...listProps} footer="only" /> : null}
    </View>
  );
}

/** The device's view settings, applied at once and saved in the background. */
function useViewPrefs() {
  const doc = useSettings(viewSettings);
  const [local, setLocal] = useState<ViewPrefs | null>(null);
  useEffect(() => {
    if (local === null && doc.status === "ready") setLocal(doc.values);
  }, [doc, local]);
  const latest = useRef(doc);
  latest.current = doc;
  const prefs = local ?? DEFAULT_VIEW_PREFS;
  const toggled = useMemo(() => new Set(prefs.toggled), [prefs.toggled]);
  const change = (patch: Partial<ViewPrefs>) => {
    const next = { ...prefs, ...patch };
    setLocal(next);
    const current = latest.current;
    if (current.status !== "ready") return;
    // A conflict means another surface of this device saved first: reload, the next change saves on top.
    void current.save(next, current.revision).then((saved) => (saved ? undefined : current.reload()));
  };
  const toggle = (key: string) =>
    change({ toggled: toggled.has(key) ? prefs.toggled.filter((entry) => entry !== key) : [...prefs.toggled, key] });
  return { prefs, toggled, change, toggle };
}

function TopBar({
  theme,
  compact,
  mode,
  onMode,
  activeOnly,
  onActiveOnly,
  searchOpen,
  onSearch,
}: {
  theme: PluginTheme;
  compact: boolean;
  mode: "projects" | "triage";
  onMode(mode: "projects" | "triage"): void;
  activeOnly: boolean;
  onActiveOnly(): void;
  searchOpen: boolean;
  onSearch(): void;
}) {
  const button = compact ? 36 : 26;
  const iconButton = (name: string, label: string, on: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({
        width: button,
        height: button,
        borderRadius: 7,
        alignItems: "center",
        justifyContent: "center",
        borderWidth: 1,
        borderColor: on ? theme.colors.border : "transparent",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Icon name={name} size={14} color={on ? theme.colors.foreground : theme.colors.foregroundMuted} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 6 }}>
      <View
        style={{
          flexDirection: "row",
          padding: 2,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: theme.colors.border,
          backgroundColor: theme.colors.surface1,
        }}
      >
        {(["projects", "triage"] as const).map((option) => (
          <Pressable
            key={option}
            accessibilityRole="tab"
            accessibilityState={{ selected: mode === option }}
            onPress={() => onMode(option)}
            style={{
              paddingHorizontal: 10,
              paddingVertical: compact ? 8 : 3,
              borderRadius: 6,
              backgroundColor: mode === option ? theme.colors.surface2 : "transparent",
            }}
          >
            <Text style={{ fontSize: 12, color: mode === option ? theme.colors.foreground : theme.colors.foregroundMuted }}>
              {option === "projects" ? "Projects" : "Triage"}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flex: 1 }} />
      {mode === "projects"
        ? iconButton("ListFilter", "Active only: hide workspaces outside the inactive window", activeOnly, onActiveOnly)
        : null}
      {iconButton("Search", "Search chats", searchOpen, onSearch)}
      {iconButton("Settings", "Recent Chats settings", false, openPluginSettings)}
    </View>
  );
}

interface ProjectsModeProps {
  snapshot: StoreSnapshot;
  rows: readonly TriageRow[];
  rowShared: RowShared;
  activeOnly: boolean;
  toggled: ReadonlySet<string>;
  onToggle(key: string): void;
  onOpenWorkspace(ref: WorkspaceRef): void;
}

function ProjectsMode({ snapshot, rows, rowShared, activeOnly, toggled, onToggle, onOpenWorkspace }: ProjectsModeProps) {
  const { theme, compact } = rowShared;
  const { prefs } = snapshot;
  const hosts = useHosts();
  const openKey = useOpenChat();
  const [stripAll, setStripAll] = useState(false);

  const workspaceRefs = useWorkspaces();
  const pinnedRefs = useWorkspaces({ where: (workspace) => workspace.pinnedAt !== null });
  const workspaceByKey = useMemo(
    () => new Map(workspaceRefs.map((ref) => [`${ref.hostId}:${ref.id}`, ref])),
    [workspaceRefs],
  );
  const pinnedWorkspaces = useMemo(() => new Set(pinnedRefs.map((ref) => `${ref.hostId}:${ref.id}`)), [pinnedRefs]);

  const tree = useMemo(() => {
    const hidden = new Set(snapshot.hosts.filter((chip) => chip.hidden).map((chip) => chip.id));
    const listed = hosts
      .filter((host) => !hidden.has(host.serverId))
      .map((host) => ({ id: host.serverId, label: host.label }));
    return buildTree(rows, listed, {
      now: Date.now(),
      inactiveWindowDays: prefs.inactiveWindowDays,
      activeOnly,
      chatsPerWorkspace: CHATS_PER_WORKSPACE,
      pinnedWorkspaces,
    });
  }, [rows, hosts, snapshot.hosts, prefs.inactiveWindowDays, activeOnly, pinnedWorkspaces]);

  // Chats that wait for you or finished unseen, plus an opened one held in place (grey).
  const urgent = useMemo(() => rows.filter((row) => row.bucket === "unread"), [rows]);
  const stripShown = stripAll ? urgent : urgent.slice(0, prefs.maxUnread);
  const stripLines = useMemo(() => visibleLines(prefs.layout), [prefs.layout]);
  const stripColumns = useMemo(() => columnChars(stripShown, prefs.layout), [stripShown, prefs.layout]);
  const treeLayout = useMemo(
    () => prefs.layout.map((token) => (TREE_HIDDEN.includes(token.id) ? { ...token, enabled: false } : token)),
    [prefs.layout],
  );
  const treeLines = useMemo(() => visibleLines(treeLayout), [treeLayout]);
  const treeColumns = useMemo(() => columnChars(rows, treeLayout), [rows, treeLayout]);
  const status = new Map(hosts.map((host) => [host.serverId, host.status]));

  const chatRow = (row: TriageRow, inStrip: boolean) => (
    <TriageRowView
      key={row.key}
      {...rowShared}
      row={row}
      showHost={inStrip && snapshot.hostCount > 1}
      hostColor={snapshot.hostColors[row.hostId]}
      lines={inStrip ? stripLines : treeLines}
      columns={inStrip ? stripColumns : treeColumns}
      current={row.key === openKey}
    />
  );
  const link = { fontSize: 12, color: theme.colors.accent, paddingHorizontal: 10, paddingVertical: compact ? 10 : 3 };

  return (
    <View>
      {urgent.length > 0 ? (
        <View
          style={{
            marginHorizontal: 8,
            marginBottom: 6,
            paddingVertical: 4,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: theme.colors.statusDanger,
            backgroundColor: theme.colors.surface1,
          }}
        >
          <Text
            style={{
              fontSize: 10.5,
              letterSpacing: 0.7,
              textTransform: "uppercase",
              fontWeight: "600",
              color: theme.colors.foregroundMuted,
              paddingHorizontal: 10,
              paddingBottom: 2,
            }}
          >
            {`Needs you \u00B7 ${urgent.filter(needsYou).length}`}
          </Text>
          {stripShown.map((row) => chatRow(row, true))}
          {urgent.length > stripShown.length ? (
            <Pressable accessibilityRole="button" onPress={() => setStripAll(true)}>
              <Text style={link}>{`+${urgent.length - stripShown.length} more`}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {tree.map((host) => (
        <HostNode
          key={host.hostId}
          host={host}
          online={status.get(host.hostId) === "online"}
          theme={theme}
          compact={compact}
          colorName={snapshot.hostColors[host.hostId]}
          toggled={toggled}
          onToggle={onToggle}
          renderProject={(project) => (
            <ProjectNode key={project.key} project={project} theme={theme} compact={compact} toggled={toggled} onToggle={onToggle}>
              {project.workspaces.map((workspace) => (
                <WorkspaceNode
                  key={workspace.key}
                  workspace={workspace}
                  reference={workspace.workspaceId ? workspaceByKey.get(workspace.key) : undefined}
                  theme={theme}
                  compact={compact}
                  folded={toggled.has(`workspace:${workspace.key}`)}
                  showOlder={toggled.has(`older:${workspace.key}`)}
                  onToggle={onToggle}
                  onOpenWorkspace={onOpenWorkspace}
                  renderChat={(row) => chatRow(row, false)}
                />
              ))}
            </ProjectNode>
          )}
        />
      ))}
      {snapshot.errors.map((error) => (
        <Text key={error} style={{ paddingHorizontal: 12, paddingVertical: 4, fontSize: 12, color: theme.colors.statusDanger }}>
          {error}
        </Text>
      ))}
    </View>
  );
}

function HostNode({
  host,
  online,
  theme,
  compact,
  colorName,
  toggled,
  onToggle,
  renderProject,
}: {
  host: TreeHost;
  online: boolean;
  theme: PluginTheme;
  compact: boolean;
  colorName: string | undefined;
  toggled: ReadonlySet<string>;
  onToggle(key: string): void;
  renderProject(project: TreeProject): ReactNode;
}) {
  const muted = { fontSize: 12, color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: compact ? 10 : 4 };
  if (!online) {
    return (
      <View style={{ opacity: 0.55 }}>
        <HostHeading theme={theme} label={`${host.label} \u00B7 offline`} colorName={colorName} unread={0} />
      </View>
    );
  }
  const foldKey = `host:${host.hostId}`;
  const quietKey = `quiet:${host.hostId}`;
  const folded = toggled.has(foldKey);
  const quietOpen = toggled.has(quietKey);
  const names = host.quiet.map((project) => project.name);
  return (
    <View>
      <HostHeading
        theme={theme}
        label={host.label}
        colorName={colorName}
        unread={host.need}
        collapsed={folded}
        onToggleCollapsed={() => onToggle(foldKey)}
      />
      {folded ? null : (
        <View>
          {host.projects.map(renderProject)}
          {host.projects.length === 0 && host.quiet.length === 0 ? <Text style={muted}>No chats.</Text> : null}
          {host.quiet.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: quietOpen }} onPress={() => onToggle(quietKey)}>
              <Text numberOfLines={1} style={muted}>
                {quietOpen
                  ? "Hide quiet projects"
                  : `${names.length} quiet project${names.length > 1 ? "s" : ""}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " \u2026" : ""}`}
              </Text>
            </Pressable>
          ) : null}
          {quietOpen ? host.quiet.map(renderProject) : null}
        </View>
      )}
    </View>
  );
}

function ProjectNode({
  project,
  theme,
  compact,
  toggled,
  onToggle,
  children,
}: {
  project: TreeProject;
  theme: PluginTheme;
  compact: boolean;
  toggled: ReadonlySet<string>;
  onToggle(key: string): void;
  children: ReactNode;
}) {
  const key = `project:${project.key}`;
  const folded = toggled.has(key);
  return (
    <View style={{ marginTop: 4 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${folded ? "Show" : "Hide"} ${project.name}`}
        accessibilityState={{ expanded: !folded }}
        onPress={() => onToggle(key)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          paddingHorizontal: 10,
          paddingVertical: compact ? 8 : 3,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
        <Icon name="Folder" size={13} color={theme.colors.foregroundMuted} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, fontWeight: "600", color: theme.colors.foreground }}>
          {project.name}
        </Text>
      </Pressable>
      {folded ? null : <View style={{ paddingLeft: 12 }}>{children}</View>}
    </View>
  );
}

function WorkspaceNode({
  workspace,
  reference,
  theme,
  compact,
  folded,
  showOlder,
  onToggle,
  onOpenWorkspace,
  renderChat,
}: {
  workspace: TreeWorkspace;
  reference: WorkspaceRef | undefined;
  theme: PluginTheme;
  compact: boolean;
  folded: boolean;
  showOlder: boolean;
  onToggle(key: string): void;
  onOpenWorkspace(ref: WorkspaceRef): void;
  renderChat(row: TriageRow): ReactNode;
}) {
  const chats = showOlder ? [...workspace.chats, ...workspace.older] : workspace.chats;
  return (
    <View style={{ marginBottom: 2 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${folded ? "Show" : "Hide"} ${workspace.name}`}
        accessibilityState={{ expanded: !folded }}
        onPress={() => onToggle(`workspace:${workspace.key}`)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: 7,
          paddingHorizontal: 10,
          minHeight: compact ? 40 : 26,
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <LedDot led={workspace.led} theme={theme} size={9} />
        <Text numberOfLines={1} style={{ flex: 1, fontSize: 13, color: theme.colors.foreground }}>
          {workspace.name}
        </Text>
        {reference ? (
          <WorkspaceActions reference={reference} theme={theme} compact={compact} onOpen={() => onOpenWorkspace(reference)} />
        ) : null}
      </Pressable>
      {folded ? null : (
        <View style={{ paddingLeft: 12 }}>
          {workspace.branch ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingBottom: 2 }}>
              <Icon name="GitBranch" size={11} color={theme.colors.foregroundMuted} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: 11, color: theme.colors.foregroundMuted }}>
                {workspace.branch}
              </Text>
            </View>
          ) : null}
          {chats.map(renderChat)}
          {workspace.older.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => onToggle(`older:${workspace.key}`)}>
              <Text style={{ fontSize: 11.5, color: theme.colors.accent, paddingHorizontal: 10, paddingVertical: compact ? 10 : 2 }}>
                {showOlder ? "Show fewer" : `+${workspace.older.length} older`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}

const KIND_LABEL: Partial<Record<string, string>> = { worktree: "worktree", checkout: "checkout", local_checkout: "checkout" };

/** Checkout or worktree chip, Paseo's workspace pin, and a button that opens the workspace. */
function WorkspaceActions({
  reference,
  theme,
  compact,
  onOpen,
}: {
  reference: WorkspaceRef;
  theme: PluginTheme;
  compact: boolean;
  onOpen(): void;
}) {
  const paseo = usePaseo();
  const meta = useWorkspace(reference, (workspace) => ({ kind: workspace.kind, pinned: workspace.pinnedAt !== null }));
  if (!meta) return null;
  const size = compact ? 32 : 20;
  const kind = KIND_LABEL[meta.kind];
  const togglePin = () =>
    void paseo.workspaces
      .ref(reference)
      .setPinned(!meta.pinned)
      .catch((error: unknown) => console.error("Recent Chats: pinning the workspace failed", error));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
      {kind ? (
        <Text
          style={{
            fontSize: 10.5,
            color: theme.colors.foregroundMuted,
            backgroundColor: theme.colors.surface2,
            borderRadius: 5,
            paddingHorizontal: 6,
            paddingVertical: 1,
          }}
        >
          {kind}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={meta.pinned ? "Unpin workspace" : "Pin workspace"}
        onPress={togglePin}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      >
        <Icon
          name={meta.pinned ? "PinOff" : "Pin"}
          size={12}
          color={meta.pinned ? theme.colors.accent : theme.colors.foregroundMuted}
        />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open workspace"
        onPress={onOpen}
        style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
      >
        <Icon name="ExternalLink" size={12} color={theme.colors.foregroundMuted} />
      </Pressable>
    </View>
  );
}
