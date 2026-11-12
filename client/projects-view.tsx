// The Projects view of the sidebar list: a Needs you strip, a Pinned section, then a
// host -> project -> workspace -> chat tree. The data comes from the store; pins of projects and
// workspaces are synced settings (prefs.treePins), chat pins the ones every list shares. The view
// choice, "active only" and folds are kept on this device (view-mode.ts).
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Easing, PanResponder, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import type { RowTokenId } from "../shared/layout";
import type { Prefs } from "../shared/settings";
import { useOpenChat } from "./open-chat";
import {
  buildTree,
  foldAll,
  type FoldAll,
  moveInOrder,
  needsYou,
  pinnedTree,
  projectComparator,
  type TreeHost,
  type TreeProject,
  type TreeWorkspace,
} from "./project-tree";
import { listDropIndex } from "./drag-target";
import { measureIn, type Box } from "./measure";
import { columnChars, visibleLines } from "./row-layout";
import type { StoreSnapshot, WorkspaceInfo } from "./store";
import { LED_RANK, type Led, type TriageRow } from "./triage";
import { hostColors } from "./format";
import { CardLayer, HostHeading, isDark, ledColor, TipButton, TriageRowView, type RowViewProps } from "./triage-list";
import { scoreRow } from "./fuzzy";
import { filterTree } from "./tree-search";
import { getStore } from "./runtime";
import { flip, resolvedView, toggleNode, updateViewMode, useViewMode } from "./view-mode";
import { attachVerticalDrag, onDoubleClick } from "./web";
import { RenameField } from "./rename-field";
import { useFontScale } from "./font-scale";

/** Pins or unpins a project (`project:` key) or workspace (`workspace:` key) on every device. */
function togglePin(key: string): void {
  const store = getStore();
  store.updatePrefs({ treePins: flip(store.getSnapshot().prefs.treePins, key) });
}

/** Chats listed per workspace before "+N older"; chats that need you, run or are pinned always show. */
const CHATS_PER_WORKSPACE = 3;

/** The tree shows host, project, workspace and branch itself, so its rows leave them out. */
const TREE_HIDDEN: readonly RowTokenId[] = ["host", "project", "workspace", "branch"];

/** Branches the "main and master" switch hides. */
const MAIN_BRANCHES: Record<string, true> = { main: true, master: true };

/** Row props that are the same for every chat row. */
export type RowShared = Omit<RowViewProps, "row" | "showHost" | "hostColor" | "lines" | "columns" | "current">;

const KIND_LABEL: Partial<Record<WorkspaceInfo["kind"], string>> = {
  worktree: "worktree",
  checkout: "checkout",
  local_checkout: "checkout",
};

/**
 * The first row of the sidebar list: Projects / Triage, the Hosts dropdown (which hosts are listed and
 * whether rows group by host), and the search button.
 */
export function ViewModeBar({
  theme,
  compact,
  showHosts,
  hostsOpen,
  onHosts,
  searchOpen,
  onSearch,
}: {
  theme: PluginTheme;
  compact: boolean;
  /** Two or more hosts are connected. */
  showHosts: boolean;
  hostsOpen: boolean;
  onHosts(): void;
  searchOpen: boolean;
  onSearch(): void;
}) {
  const mode = useViewMode();
  const fs = useFontScale();
  const view = resolvedView(mode, compact);
  const size = compact ? 36 : 26;
  const toggle = (on: boolean) => ({
    minHeight: size,
    minWidth: size,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    flexDirection: "row" as const,
    gap: 4,
    paddingHorizontal: 6,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: on ? theme.colors.border : "transparent",
    backgroundColor: on ? theme.colors.surface2 : "transparent",
  });
  const tone = (on: boolean) => (on ? theme.colors.foreground : theme.colors.foregroundMuted);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4 }}>
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
            accessibilityState={{ selected: view === option }}
            onPress={() => updateViewMode({ view: option })}
            style={{
              paddingHorizontal: 10,
              paddingVertical: compact ? 8 : 3,
              borderRadius: 6,
              backgroundColor: view === option ? theme.colors.surface2 : "transparent",
            }}
          >
            <Text style={{ fontSize: fs(12), color: tone(view === option) }}>{option === "projects" ? "Projects" : "Triage"}</Text>
          </Pressable>
        ))}
      </View>
      {showHosts ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Hosts: which hosts are listed, and grouping by host"
          accessibilityState={{ expanded: hostsOpen }}
          onPress={onHosts}
          style={toggle(hostsOpen)}
        >
          <Icon name="Server" size={13} color={tone(hostsOpen)} />
          <Icon name={hostsOpen ? "ChevronUp" : "ChevronDown"} size={11} color={tone(hostsOpen)} />
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={searchOpen ? "Close search" : "Search"}
        accessibilityState={{ expanded: searchOpen }}
        onPress={onSearch}
        style={toggle(searchOpen)}
      >
        <Icon name="Search" size={13} color={tone(searchOpen)} />
      </Pressable>
    </View>
  );
}

export function ProjectsView({
  snapshot,
  rows,
  rowShared,
  query,
}: {
  snapshot: StoreSnapshot;
  rows: readonly TriageRow[];
  rowShared: RowShared;
  /** Search text: the view is filtered to what matches, drawn the same way. */
  query: string;
}) {
  const { theme, compact } = rowShared;
  const { prefs } = snapshot;
  const mode = useViewMode();
  const fs = useFontScale();
  const openKey = useOpenChat();
  const [stripAll, setStripAll] = useState(false);
  const searching = query.trim().length > 0;
  // While searching every match shows: folds are ignored.
  const toggled = useMemo(() => (searching ? new Set<string>() : new Set(mode.toggled)), [searching, mode.toggled]);
  const treePins = prefs.treePins;
  const pins = useMemo(() => new Set(treePins), [treePins]);
  const pinnedWorkspaces = useMemo(
    () => new Set(treePins.filter((pin) => pin.startsWith("workspace:")).map((pin) => pin.slice("workspace:".length))),
    [treePins],
  );
  const pinnedProjects = useMemo(
    () => new Set(treePins.filter((pin) => pin.startsWith("project:")).map((pin) => pin.slice("project:".length))),
    [treePins],
  );
  const workspaceInfo = useMemo(
    () => new Map(snapshot.workspaces.map((info) => [`${info.hostId}:${info.id}`, info])),
    [snapshot.workspaces],
  );

  const listed = useMemo(
    () => snapshot.hosts.filter((host) => !host.hidden).map((host) => ({ id: host.id, label: host.label })),
    [snapshot.hosts],
  );
  const tree = useMemo(
    () =>
      buildTree(rows, listed, {
        now: Date.now(),
        inactiveWindowDays: prefs.inactiveWindowDays,
        activeOnly: mode.activeOnly,
        chatsPerWorkspace: CHATS_PER_WORKSPACE,
        pinnedWorkspaces,
        pinnedProjects,
        projectOrder: prefs.projectOrder,
        workspaceOrder: prefs.workspaceOrder,
      }),
    [rows, listed, prefs.inactiveWindowDays, mode.activeOnly, pinnedWorkspaces, pinnedProjects, prefs.projectOrder, prefs.workspaceOrder],
  );
  // Everything, unfiltered: the base of the Pinned section and of search.
  const full = useMemo(
    () =>
      buildTree(rows, listed, {
        now: Date.now(),
        inactiveWindowDays: prefs.inactiveWindowDays,
        activeOnly: false,
        chatsPerWorkspace: Number.MAX_SAFE_INTEGER,
        pinnedWorkspaces,
        pinnedProjects,
        projectOrder: prefs.projectOrder,
        workspaceOrder: prefs.workspaceOrder,
      }),
    [rows, listed, prefs.inactiveWindowDays, pinnedWorkspaces, pinnedProjects, prefs.projectOrder, prefs.workspaceOrder],
  );
  const pinned = useMemo(() => filterTree(pinnedTree(full, pinnedProjects), query), [full, pinnedProjects, query]);
  // Searching looks through everything, also what "active only" and "+N older" hide.
  const shownTree = useMemo(() => (searching ? filterTree(full, query) : tree), [searching, full, tree, query]);

  // Chats that wait for you or finished unseen, plus an opened one held in place (grey).
  const urgent = useMemo(
    () => rows.filter((row) => row.bucket === "unread" && (!searching || scoreRow(query, row) !== null)),
    [rows, searching, query],
  );
  // The frame takes the light of its most urgent chat; grey when only a held (opened) chat is left.
  const stripLed = urgent.reduce<Led>((worst, row) => (LED_RANK[row.led] < LED_RANK[worst] ? row.led : worst), "idle");
  const stripShown = stripAll ? urgent : urgent.slice(0, prefs.maxUnread);
  const stripLines = useMemo(() => visibleLines(prefs.layout), [prefs.layout]);
  const stripColumns = useMemo(() => columnChars(stripShown, prefs.layout), [stripShown, prefs.layout]);
  const show = prefs.projectsShow;
  // The tree draws host, project, workspace and branch itself; age and agent follow the Projects settings.
  const treeLayout = useMemo(
    () =>
      prefs.layout.map((token) =>
        TREE_HIDDEN.includes(token.id)
          ? { ...token, enabled: false }
          : token.id === "age"
            ? { ...token, enabled: show.age }
            : token.id === "agent"
              ? { ...token, enabled: show.agent }
              : token,
      ),
    [prefs.layout, show.age, show.agent],
  );
  const treeLines = useMemo(() => visibleLines(treeLayout), [treeLayout]);
  const treeColumns = useMemo(() => columnChars(rows, treeLayout), [rows, treeLayout]);

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
  const link = { fontSize: fs(12), color: theme.colors.accent, paddingHorizontal: 10, paddingVertical: compact ? 10 : 3 };
  const heading = {
    fontSize: fs(10.5),
    letterSpacing: 0.7,
    textTransform: "uppercase" as const,
    fontWeight: "600" as const,
    color: theme.colors.foregroundMuted,
  };

  const flat = !prefs.projectsGroupByHost;
  const renderWorkspace = (workspace: TreeWorkspace, prefix: string, inPinned: boolean, drag?: ItemDrag) => (
    <WorkspaceNode
      show={show}
      key={prefix + workspace.key}
      workspace={workspace}
      info={workspace.workspaceId ? workspaceInfo.get(workspace.key) : undefined}
      prefix={prefix}
      pinned={pins.has(`workspace:${workspace.key}`)}
      theme={theme}
      compact={compact}
      folded={toggled.has(`${prefix}workspace:${workspace.key}`)}
      showOlder={inPinned || toggled.has(`${prefix}older:${workspace.key}`)}
      drag={drag}
      renderChat={(row) => chatRow(row, false)}
    />
  );
  const renderProject = (project: TreeProject, prefix: string, inPinned: boolean, drag?: ItemDrag) => (
    <ProjectNode
      key={prefix + project.key}
      project={project}
      prefix={prefix}
      pinned={pins.has(`project:${project.key}`)}
      theme={theme}
      compact={compact}
      toggled={toggled}
      hostTag={flat && show.hostTag ? hostOfProject(project, snapshot) : undefined}
      drag={drag}
    >
      {inPinned ? (
        project.workspaces.map((workspace) => renderWorkspace(workspace, prefix, inPinned))
      ) : (
        <SortableList
          items={project.workspaces}
          orderKey="workspaceOrder"
          theme={theme}
          render={(workspace, workspaceDrag) => renderWorkspace(workspace, prefix, inPinned, workspaceDrag)}
        />
      )}
    </ProjectNode>
  );
  /** prefix keeps the Pinned section's folds apart from the tree's. */
  const renderHosts = (hosts: readonly TreeHost[], prefix: string, inPinned: boolean) => {
    if (flat) {
      const merged = mergeHosts(hosts, prefs.projectOrder);
      return (
        <FlatProjects
          key={prefix + "flat"}
          merged={merged}
          prefix={prefix}
          theme={theme}
          compact={compact}
          toggled={toggled}
          sortable={!inPinned}
          renderProject={(project, drag) => renderProject(project, prefix, inPinned, drag)}
        />
      );
    }
    return hosts.map((host) => (
      <HostNode
        key={prefix + host.hostId}
        host={host}
        prefix={prefix}
        theme={theme}
        compact={compact}
        colorName={snapshot.hostColors[host.hostId]}
        toggled={toggled}
        sortable={!inPinned}
        renderProject={(project, drag) => renderProject(project, prefix, inPinned, drag)}
      />
    ));
  };

  const pinnedFolded = toggled.has("pinned");
  /** Collapse, Expand and Active for one section: "" the tree, "pinned/" the Pinned section. */
  const foldButtons = (hosts: readonly TreeHost[], prefix: string) =>
    FOLD_ACTIONS.map(([action, icon, label]) => (
      <TipButton
        key={action}
        theme={theme}
        compact={compact}
        icon={icon}
        label={label}
        onPress={() => updateViewMode({ toggled: foldAll(hosts, mode.toggled, action, prefix) })}
      />
    ));
  return (
    <CardLayer>
          {urgent.length > 0 ? (
            <View
              style={{
                marginHorizontal: 8,
                marginBottom: 6,
                paddingVertical: 4,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: stripLed === "idle" ? theme.colors.border : ledColor(theme, stripLed),
                backgroundColor: theme.colors.surface1,
              }}
            >
              <Text style={[heading, { paddingHorizontal: 10, paddingBottom: 2 }]}>
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
          {pinned.length > 0 ? (
            <View style={{ marginBottom: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 6 }}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !pinnedFolded }}
                  onPress={() => toggleNode("pinned")}
                  style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: compact ? 8 : 4 }}
                >
                  <Icon name={pinnedFolded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
                  <Icon name="Pin" size={12} color={theme.colors.accent} />
                  <Text style={heading}>Pinned</Text>
                </Pressable>
                {pinnedFolded ? null : foldButtons(pinned, "pinned/")}
              </View>
              {pinnedFolded ? null : (
                <View style={{ marginLeft: 8, borderLeftWidth: 2, borderLeftColor: theme.colors.accent }}>
                  {renderHosts(pinned, "pinned/", true)}
                </View>
              )}
            </View>
          ) : searching ? null : (
            <Text style={{ fontSize: fs(11.5), color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingBottom: 6 }}>
              Pin a project, workspace or chat to keep it here, with what is around it.
            </Text>
          )}
          {searching ? null : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingTop: 2 }}>
              {/* Hides workspaces with nothing newer than the inactive window (Settings, Sections, Inactive, Window). */}
              <Pressable
                accessibilityRole="switch"
                accessibilityLabel={`Only workspaces active in the last ${prefs.inactiveWindowDays} days`}
                accessibilityState={{ checked: mode.activeOnly }}
                onPress={() => updateViewMode({ activeOnly: !mode.activeOnly })}
                hitSlop={4}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingHorizontal: 6,
                  paddingVertical: compact ? 8 : 2,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: mode.activeOnly ? theme.colors.border : "transparent",
                  backgroundColor: mode.activeOnly ? theme.colors.surface2 : "transparent",
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Icon name="ListFilter" size={12} color={mode.activeOnly ? theme.colors.foreground : theme.colors.foregroundMuted} />
                <Text style={{ fontSize: fs(11), color: mode.activeOnly ? theme.colors.foreground : theme.colors.foregroundMuted }}>
                  {`Last ${prefs.inactiveWindowDays}d`}
                </Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              {foldButtons(full, "")}
            </View>
          )}
          {renderHosts(shownTree, "", false)}
          {searching && shownTree.length === 0 && pinned.length === 0 && urgent.length === 0 ? (
            <Text style={{ fontSize: fs(12), color: theme.colors.foregroundMuted, padding: 12 }}>Nothing matches.</Text>
          ) : null}
    </CardLayer>
  );
}

/** The fold-all buttons: action, icon, tooltip. */
const FOLD_ACTIONS: readonly [FoldAll, string, string][] = [
  ["collapse", "ChevronsDownUp", "Collapse all projects"],
  ["expand", "ChevronsUpDown", "Expand all projects and workspaces"],
  ["active", "Activity", "Collapse everything, then open what is active"],
];

/** Host label and colour of a project (its key starts with the host id). */
function hostOfProject(project: TreeProject, snapshot: StoreSnapshot): { label: string; colorName: string | undefined } {
  const hostId = project.key.slice(0, project.key.indexOf(":"));
  const host = snapshot.hosts.find((candidate) => candidate.id === hostId);
  return { label: host?.label ?? hostId, colorName: snapshot.hostColors[hostId] };
}

/** All hosts' projects as one list in the dragged order, then by name; quiet ones likewise. */
function mergeHosts(hosts: readonly TreeHost[], order: readonly string[]): { projects: TreeProject[]; quiet: TreeProject[] } {
  const byOrder = projectComparator(order);
  return {
    projects: hosts.flatMap((host) => host.projects).sort(byOrder),
    quiet: hosts.flatMap((host) => host.quiet).sort(byOrder),
  };
}

function FlatProjects({
  merged,
  prefix,
  theme,
  compact,
  toggled,
  sortable,
  renderProject,
}: {
  merged: { projects: TreeProject[]; quiet: TreeProject[] };
  prefix: string;
  theme: PluginTheme;
  compact: boolean;
  toggled: ReadonlySet<string>;
  /** The projects can be reordered by dragging their folder icon (not in the Pinned section). */
  sortable: boolean;
  renderProject(project: TreeProject, drag?: ItemDrag): ReactNode;
}) {
  const quietKey = `${prefix}quiet:all`;
  const quietOpen = toggled.has(quietKey);
  const names = merged.quiet.map((project) => project.name);
  const fs = useFontScale();
  const muted = { fontSize: fs(12), color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: compact ? 10 : 4 };
  return (
    <View>
      {sortable ? (
        <SortableList items={merged.projects} orderKey="projectOrder" theme={theme} render={renderProject} />
      ) : (
        merged.projects.map((project) => renderProject(project))
      )}
      {merged.quiet.length > 0 ? (
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: quietOpen }} onPress={() => toggleNode(quietKey)}>
          <Text numberOfLines={1} style={muted}>
            {quietOpen
              ? "Hide quiet projects"
              : `${names.length} quiet project${names.length > 1 ? "s" : ""}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " \u2026" : ""}`}
          </Text>
        </Pressable>
      ) : null}
      {quietOpen ? merged.quiet.map((project) => renderProject(project)) : null}
    </View>
  );
}

function PinButton({ theme, compact, pinned, label, onPress }: { theme: PluginTheme; compact: boolean; pinned: boolean; label: string; onPress(): void }) {
  const size = compact ? 32 : 20;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={pinned ? `Unpin ${label}` : `Pin ${label}`}
      accessibilityState={{ selected: pinned }}
      onPress={onPress}
      hitSlop={6}
      style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}
    >
      <Icon name={pinned ? "PinOff" : "Pin"} size={12} color={pinned ? theme.colors.accent : theme.colors.foregroundMuted} />
    </Pressable>
  );
}

function HostNode({
  host,
  prefix,
  theme,
  compact,
  colorName,
  toggled,
  sortable,
  renderProject,
}: {
  host: TreeHost;
  prefix: string;
  theme: PluginTheme;
  compact: boolean;
  colorName: string | undefined;
  toggled: ReadonlySet<string>;
  /** The projects can be reordered by dragging their folder icon (not in the Pinned section). */
  sortable: boolean;
  renderProject(project: TreeProject, drag?: ItemDrag): ReactNode;
}) {
  const fs = useFontScale();
  const muted = { fontSize: fs(12), color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: compact ? 10 : 4 };
  const foldKey = `${prefix}host:${host.hostId}`;
  const quietKey = `${prefix}quiet:${host.hostId}`;
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
        onToggleCollapsed={() => toggleNode(foldKey)}
      />
      {folded ? null : (
        <View>
          {sortable ? (
            <SortableList items={host.projects} orderKey="projectOrder" theme={theme} render={renderProject} />
          ) : (
            host.projects.map((project) => renderProject(project))
          )}
          {host.projects.length === 0 && host.quiet.length === 0 ? <Text style={muted}>No chats.</Text> : null}
          {host.quiet.length > 0 ? (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: quietOpen }} onPress={() => toggleNode(quietKey)}>
              <Text numberOfLines={1} style={muted}>
                {quietOpen
                  ? "Hide quiet projects"
                  : `${names.length} quiet project${names.length > 1 ? "s" : ""}: ${names.slice(0, 3).join(", ")}${names.length > 3 ? " \u2026" : ""}`}
              </Text>
            </Pressable>
          ) : null}
          {quietOpen ? host.quiet.map((project) => renderProject(project)) : null}
        </View>
      )}
    </View>
  );
}

function HostPill({ theme, label, colorName }: { theme: PluginTheme; label: string; colorName: string | undefined }) {
  const tint = hostColors(colorName, isDark(theme.colors.surface0));
  const fs = useFontScale();
  return (
    <View style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 5, backgroundColor: tint?.background ?? theme.colors.surface2 }}>
      <Text numberOfLines={1} style={{ fontSize: fs(10), fontWeight: "600", color: tint?.text ?? theme.colors.foregroundMuted }}>
        {label}
      </Text>
    </View>
  );
}

function ProjectNode({
  project,
  prefix,
  pinned,
  theme,
  compact,
  toggled,
  hostTag,
  drag,
  children,
}: {
  project: TreeProject;
  prefix: string;
  pinned: boolean;
  theme: PluginTheme;
  compact: boolean;
  toggled: ReadonlySet<string>;
  /** Shown at the right when projects are not grouped by host. */
  hostTag: { label: string; colorName: string | undefined } | undefined;
  /** Present where projects can be reordered: the folder icon is the drag handle. */
  drag: ItemDrag | undefined;
  children: ReactNode;
}) {
  const key = `${prefix}project:${project.key}`;
  const folded = toggled.has(key);
  const fs = useFontScale();
  // Like a workspace: full colour while something happens in one of its workspaces, grey otherwise.
  const busy = project.workspaces.some((workspace) => workspace.led !== "idle");
  const fold = {
    accessibilityRole: "button" as const,
    accessibilityLabel: `${folded ? "Show" : "Hide"} ${project.name}`,
    accessibilityState: { expanded: !folded },
    onPress: () => toggleNode(key),
  };
  const folder = <Icon name="Folder" size={13} color={theme.colors.foregroundMuted} />;
  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 6, paddingVertical: compact ? 5 : 0 }}>
        <Pressable
          {...fold}
          hitSlop={4}
          style={({ pressed }) => ({ paddingLeft: 10, paddingRight: 6, paddingVertical: 3, opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
        {drag ? (
          <DragHandle drag={drag} label={project.name}>
            {folder}
          </DragHandle>
        ) : (
          folder
        )}
        <Pressable
          {...fold}
          style={({ pressed }) => ({ flex: 1, paddingLeft: 6, paddingRight: 10, paddingVertical: compact ? 3 : 3, opacity: pressed ? 0.6 : 1 })}
        >
          <Text
            numberOfLines={1}
            style={{
              fontSize: fs(12),
              fontWeight: "600",
              letterSpacing: 0.6,
              textTransform: "uppercase",
              color: busy ? theme.colors.foreground : theme.colors.foregroundMuted,
            }}
          >
            {project.name}
          </Text>
        </Pressable>
        {hostTag ? <HostPill theme={theme} label={hostTag.label} colorName={hostTag.colorName} /> : null}
        <PinButton theme={theme} compact={compact} pinned={pinned} label={`project ${project.name}`} onPress={() => togglePin(`project:${project.key}`)} />
      </View>
      {folded ? null : <View style={{ paddingLeft: 12 }}>{children}</View>}
    </View>
  );
}

/** Drag of one project or workspace, by its handle. */
interface ItemDrag {
  start(): void;
  move(dy: number): void;
  end(): void;
}

/** Web-only styles that keep a drag from selecting text or scrolling a touch screen. */
const GRAB_WEB = (Platform.OS === "web" ? { cursor: "grab", userSelect: "none", touchAction: "none" } : {}) as ViewStyle;

/**
 * Grip around a handle icon. React Native's responder drives it on phones; on the web the app's sidebar
 * takes pointer events first, so the handle listens to them itself (see web.ts).
 */
function DragHandle({ drag, label, children }: { drag: ItemDrag; label: string; children: ReactNode }) {
  const node = useRef<View>(null);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Platform.OS !== "web",
        onMoveShouldSetPanResponder: () => Platform.OS !== "web",
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: drag.start,
        onPanResponderMove: (_event, gesture) => drag.move(gesture.dy),
        onPanResponderRelease: drag.end,
        onPanResponderTerminate: drag.end,
      }),
    [drag],
  );
  useEffect(() => attachVerticalDrag(node.current, drag), [drag]);
  return (
    <View ref={node} accessibilityLabel={`Drag ${label} to reorder`} {...pan.panHandlers} style={[{ padding: 3 }, GRAB_WEB]}>
      {children}
    </View>
  );
}

/** Height of a heading: drops are decided against headings, not whole (unfolded) items. */
const HEADING_HEIGHT = 26;

/**
 * A list of projects or workspaces that can be reordered by dragging their handle. The others glide out
 * of the way while dragging; the new order is saved in `orderKey` for every device.
 */
function SortableList<Item extends { key: string }>({
  items,
  orderKey,
  theme,
  render,
}: {
  items: readonly Item[];
  orderKey: "projectOrder" | "workspaceOrder";
  theme: PluginTheme;
  render(item: Item, drag: ItemDrag): ReactNode;
}) {
  const container = useRef<View>(null);
  const nodes = useRef(new Map<string, View | null>());
  const boxes = useRef(new Map<string, Box>());
  const [drag, setDrag] = useState<{ key: string; dy: number; to: number } | null>(null);
  const latest = useRef(items);
  latest.current = items;

  const handlers = useRef(new Map<string, ItemDrag>());
  const handlersFor = (key: string): ItemDrag => {
    const existing = handlers.current.get(key);
    if (existing) return existing;
    let dy = 0;
    const keys = () => latest.current.map((item) => item.key);
    const target = (offset: number) => {
      const list = keys();
      const from = list.indexOf(key);
      const headings = list.map((candidate) => ({ top: boxes.current.get(candidate)?.top ?? 0, height: HEADING_HEIGHT }));
      const top = boxes.current.get(key)?.top ?? 0;
      return { from, to: listDropIndex(headings, from, top + HEADING_HEIGHT / 2 + offset) };
    };
    const created: ItemDrag = {
      start() {
        dy = 0;
        measureIn(container.current, nodes.current, (fresh) => {
          boxes.current = fresh;
        });
        setDrag({ key, dy: 0, to: keys().indexOf(key) });
      },
      move(offset) {
        dy = offset;
        setDrag({ key, dy: offset, to: target(offset).to });
      },
      end() {
        const { from, to } = target(dy);
        setDrag(null);
        if (from < 0 || to === from) return;
        const shown = keys();
        const order = moveInOrder([], shown, key, to);
        // Where the item lands, from the measured heights: it glides there from where it was let go.
        const firstTop = Math.min(...shown.map((candidate) => boxes.current.get(candidate)?.top ?? 0));
        let landTop = firstTop;
        for (const candidate of order) {
          if (candidate === key) break;
          landTop += boxes.current.get(candidate)?.height ?? 0;
        }
        setLanding({ key, order, from: (boxes.current.get(key)?.top ?? 0) + dy - landTop });
        const store = getStore();
        store.updatePrefs({ [orderKey]: moveInOrder(store.getSnapshot().prefs[orderKey], shown, key, to) });
      },
    };
    handlers.current.set(key, created);
    return created;
  };

  // After a drop the list is drawn in its new order at once, until the saved order arrives, so nothing jumps back.
  const [landing, setLanding] = useState<{ key: string; order: string[]; from: number } | null>(null);
  const itemKeys = items.map((item) => item.key).join("\n");
  useEffect(() => {
    if (!landing) return;
    if (itemKeys === landing.order.join("\n")) {
      const settled = setTimeout(() => setLanding(null), 200);
      return () => clearTimeout(settled);
    }
    const giveUp = setTimeout(() => setLanding(null), 2000);
    return () => clearTimeout(giveUp);
  }, [itemKeys, landing]);
  const byKey = new Map(items.map((item) => [item.key, item]));
  const shown = landing
    ? [
        ...landing.order.flatMap((key) => {
          const item = byKey.get(key);
          return item ? [item] : [];
        }),
        ...items.filter((item) => !landing.order.includes(item.key)),
      ]
    : items;

  // Shuffle: while dragging, the items between the dragged one's old and new place move aside by its height.
  const dragFrom = drag ? items.findIndex((item) => item.key === drag.key) : -1;
  const dragHeight = drag ? (boxes.current.get(drag.key)?.height ?? HEADING_HEIGHT) : 0;
  const shiftOf = (index: number) => {
    if (!drag || index === dragFrom) return 0;
    const other = index < dragFrom ? index : index - 1;
    if (dragFrom < drag.to && other >= dragFrom && other < drag.to) return -dragHeight;
    if (drag.to < dragFrom && other >= drag.to && other < dragFrom) return dragHeight;
    return 0;
  };

  return (
    <View ref={container} style={{ position: "relative" }}>
      {shown.map((item, index) => {
        const dragged = drag?.key === item.key;
        const lands = landing?.key === item.key;
        return (
          <ShiftingItem
            key={item.key}
            shift={shiftOf(index)}
            dragging={drag !== null}
            landFrom={lands ? landing.from : null}
            nodeRef={(node) => {
              nodes.current.set(item.key, node);
            }}
            style={
              dragged
                ? { transform: [{ translateY: drag.dy }], zIndex: 10, opacity: 0.9, backgroundColor: theme.colors.surface1, borderRadius: 8 }
                : lands
                  ? { zIndex: 10 }
                  : null
            }
          >
            {render(item, handlersFor(item.key))}
          </ShiftingItem>
        );
      })}
    </View>
  );
}

/**
 * One item of a sortable list. While a drag is on, it glides to `shift` (out of the dragged item's way).
 * When the drag ends the list is drawn in its new order: the others stand still, and the dropped item
 * glides from where it was let go (`landFrom`, relative to its new place) into place.
 */
function ShiftingItem({
  shift,
  dragging,
  landFrom,
  nodeRef,
  style,
  children,
}: {
  shift: number;
  dragging: boolean;
  landFrom: number | null;
  nodeRef(node: View | null): void;
  style: ViewStyle | null;
  children: ReactNode;
}) {
  const offset = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const glide = (toValue: number) =>
      Animated.timing(offset, { toValue, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== "web" });
    if (landFrom !== null) {
      offset.setValue(landFrom);
      const land = glide(0);
      land.start();
      return () => land.stop();
    }
    if (!dragging) {
      offset.setValue(0);
      return;
    }
    const move = glide(shift);
    move.start();
    return () => move.stop();
  }, [shift, dragging, landFrom, offset]);
  return (
    <Animated.View ref={nodeRef} style={[style, dragging && style ? null : { transform: [{ translateY: offset }] }]}>
      {children}
    </Animated.View>
  );
}

function WorkspaceNode({
  show,
  workspace,
  info,
  prefix,
  pinned,
  theme,
  compact,
  folded,
  showOlder,
  drag,
  renderChat,
}: {
  show: Prefs["projectsShow"];
  workspace: TreeWorkspace;
  info: WorkspaceInfo | undefined;
  prefix: string;
  pinned: boolean;
  theme: PluginTheme;
  compact: boolean;
  folded: boolean;
  showOlder: boolean;
  /** Present where workspaces can be reordered: the grip before the name is the drag handle. */
  drag: ItemDrag | undefined;
  renderChat(row: TriageRow): ReactNode;
}) {
  const chats = showOlder ? [...workspace.chats, ...workspace.older] : workspace.chats;
  const kind = show.kind && info ? KIND_LABEL[info.kind] : undefined;
  const fs = useFontScale();
  const small = { fontSize: fs(10.5), color: theme.colors.foregroundMuted };
  const branch = show.branch && (show.mainBranch || !MAIN_BRANCHES[workspace.branch]) ? workspace.branch : "";
  const name = info?.title ?? workspace.name;
  const foldKey = `${prefix}workspace:${workspace.key}`;
  // Long press (or a double-click on the web) renames the workspace on its host, as with chats.
  const [editing, setEditing] = useState(false);
  const nameNode = useRef<View>(null);
  const workspaceId = workspace.workspaceId;
  const startRename = workspaceId ? () => setEditing(true) : null;
  const latestStart = useRef(startRename);
  latestStart.current = startRename;
  useEffect(() => onDoubleClick(nameNode.current, () => latestStart.current?.()), [editing]);
  const grip = <Icon name="GripVertical" size={12} color={theme.colors.foregroundMuted} />;
  return (
    <View style={{ marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 6, minHeight: compact ? 40 : 26 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${folded ? "Show" : "Hide"} ${name}`}
          accessibilityState={{ expanded: !folded }}
          onPress={() => toggleNode(foldKey)}
          hitSlop={4}
          style={({ pressed }) => ({ paddingLeft: 10, paddingRight: 4, paddingVertical: 3, opacity: pressed ? 0.6 : 1 })}
        >
          <Icon name={folded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
        {drag ? (
          <DragHandle drag={drag} label={name}>
            {grip}
          </DragHandle>
        ) : (
          <View style={{ padding: 3 }}>{grip}</View>
        )}
        {editing && workspaceId ? (
          <View style={{ flex: 1, paddingHorizontal: 4 }}>
            <RenameField
              theme={theme}
              compact={compact}
              initial={name}
              onSave={(title) => getStore().renameWorkspace(workspace.hostId, workspaceId, title)}
              onClose={() => setEditing(false)}
            />
          </View>
        ) : (
        <Pressable
          ref={nameNode}
          accessibilityRole="button"
          accessibilityLabel={`${folded ? "Show" : "Hide"} ${name}`}
          accessibilityHint={startRename ? "Long press to rename" : undefined}
          accessibilityState={{ expanded: !folded }}
          onPress={() => toggleNode(foldKey)}
          onLongPress={startRename ?? undefined}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingLeft: 4,
            paddingRight: 10,
            minHeight: compact ? 40 : 26,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {/* White while something happens in it (running, asking, unseen); grey like its chats otherwise. */}
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontSize: fs(13), color: workspace.led === "idle" ? theme.colors.foregroundMuted : theme.colors.foreground }}
          >
            {name}
          </Text>
          {show.diff && info?.diff && (info.diff.additions || info.diff.deletions) ? (
            <Text style={small}>
              <Text style={{ color: theme.colors.statusSuccess }}>{`+${info.diff.additions}`}</Text>{" "}
              <Text style={{ color: theme.colors.statusDanger }}>{`\u2212${info.diff.deletions}`}</Text>
            </Text>
          ) : null}
          {kind ? (
            <Text style={[small, { backgroundColor: theme.colors.surface2, borderRadius: 5, paddingHorizontal: 6, paddingVertical: 1 }]}>
              {kind}
            </Text>
          ) : null}
        </Pressable>
        )}
        {workspace.workspaceId ? (
          <PinButton
            theme={theme}
            compact={compact}
            pinned={pinned}
            label={`workspace ${info?.title ?? workspace.name}`}
            onPress={() => togglePin(`workspace:${workspace.key}`)}
          />
        ) : null}
      </View>
      {folded ? null : (
        <View style={{ paddingLeft: 12 }}>
          {branch ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingBottom: 2 }}>
              <Icon name="GitBranch" size={11} color={theme.colors.foregroundMuted} />
              <Text numberOfLines={1} style={{ flex: 1, fontSize: fs(11), color: theme.colors.foregroundMuted }}>
                {branch}
              </Text>
            </View>
          ) : null}
          {chats.map(renderChat)}
          {workspace.older.length > 0 ? (
            <Pressable accessibilityRole="button" onPress={() => toggleNode(`${prefix}older:${workspace.key}`)}>
              <Text style={{ fontSize: fs(11.5), color: theme.colors.accent, paddingHorizontal: 10, paddingVertical: compact ? 10 : 2 }}>
                {showOlder ? "Show fewer" : `+${workspace.older.length} older`}
              </Text>
            </Pressable>
          ) : null}
        </View>
      )}
    </View>
  );
}
