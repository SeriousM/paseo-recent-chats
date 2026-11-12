// The Projects view of the sidebar list: a Needs you strip, a Pinned section, then a
// host -> project -> workspace -> chat tree. The data comes from the store; pins of projects and
// workspaces are synced settings (prefs.treePins), chat pins the ones every list shares. The view
// choice, "active only" and folds are kept on this device (view-mode.ts).
import type { PluginTheme } from "@getpaseo/plugin";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Platform, Pressable, Text, View, type ViewStyle } from "react-native";
import type { RowTokenId } from "../shared/layout";
import type { Prefs } from "../shared/settings";
import { useOpenChat } from "./open-chat";
import {
  buildTree,
  moveProject,
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
import { HostHeading, isDark, LedDot, ledColor, TriageRowView, type RowViewProps } from "./triage-list";
import { scoreRow } from "./fuzzy";
import { filterTree } from "./tree-search";
import { getStore } from "./runtime";
import { flip, resolvedView, toggleNode, updateViewMode, useViewMode } from "./view-mode";
import { attachVerticalDrag } from "./web";
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
 * whether rows group by host), Active only (Projects), and the search button.
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
      {view === "projects" ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Active only: hide workspaces outside the inactive window"
          accessibilityState={{ selected: mode.activeOnly }}
          onPress={() => updateViewMode({ activeOnly: !mode.activeOnly })}
          style={toggle(mode.activeOnly)}
        >
          <Icon name="ListFilter" size={13} color={tone(mode.activeOnly)} />
          <Text style={{ fontSize: fs(11.5), color: tone(mode.activeOnly) }}>Active</Text>
        </Pressable>
      ) : null}
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
      }),
    [rows, listed, prefs.inactiveWindowDays, mode.activeOnly, pinnedWorkspaces, pinnedProjects, prefs.projectOrder],
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
      }),
    [rows, listed, prefs.inactiveWindowDays, pinnedWorkspaces, pinnedProjects, prefs.projectOrder],
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
  const renderProject = (project: TreeProject, prefix: string, inPinned: boolean, drag?: ProjectDrag) => (
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
      {project.workspaces.map((workspace) => (
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
          renderChat={(row) => chatRow(row, false)}
        />
      ))}
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
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: !pinnedFolded }}
                onPress={() => toggleNode("pinned")}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: compact ? 8 : 4 }}
              >
                <Icon name={pinnedFolded ? "ChevronRight" : "ChevronDown"} size={12} color={theme.colors.foregroundMuted} />
                <Icon name="Pin" size={12} color={theme.colors.accent} />
                <Text style={heading}>Pinned</Text>
              </Pressable>
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
          {renderHosts(shownTree, "", false)}
          {searching && shownTree.length === 0 && pinned.length === 0 && urgent.length === 0 ? (
            <Text style={{ fontSize: fs(12), color: theme.colors.foregroundMuted, padding: 12 }}>Nothing matches.</Text>
          ) : null}
    </View>
  );
}

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
  renderProject(project: TreeProject, drag?: ProjectDrag): ReactNode;
}) {
  const quietKey = `${prefix}quiet:all`;
  const quietOpen = toggled.has(quietKey);
  const names = merged.quiet.map((project) => project.name);
  const fs = useFontScale();
  const muted = { fontSize: fs(12), color: theme.colors.foregroundMuted, paddingHorizontal: 12, paddingVertical: compact ? 10 : 4 };
  return (
    <View>
      {sortable ? (
        <SortableProjects projects={merged.projects} theme={theme} render={renderProject} />
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
  renderProject(project: TreeProject, drag?: ProjectDrag): ReactNode;
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
            <SortableProjects projects={host.projects} theme={theme} render={renderProject} />
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
  drag: ProjectDrag | undefined;
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

/** Drag of one project, by its folder icon. */
interface ProjectDrag {
  start(): void;
  move(dy: number): void;
  end(): void;
}

/** Web-only styles that keep a drag from selecting text or scrolling a touch screen. */
const GRAB_WEB = (Platform.OS === "web" ? { cursor: "grab", userSelect: "none", touchAction: "none" } : {}) as ViewStyle;

/**
 * Grip around the folder icon. React Native's responder drives it on phones; on the web the app's
 * sidebar takes pointer events first, so the handle listens to them itself (see web.ts).
 */
function DragHandle({ drag, label, children }: { drag: ProjectDrag; label: string; children: ReactNode }) {
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
    <View
      ref={node}
      accessibilityLabel={`Drag ${label} to reorder projects`}
      {...pan.panHandlers}
      style={[{ padding: 3 }, GRAB_WEB]}
    >
      {children}
    </View>
  );
}

/** Height of a project's heading: drops are decided against headings, not whole (unfolded) projects. */
const PROJECT_HEADING = 26;

/**
 * A list of projects that can be reordered by dragging a folder icon. A marker shows where the project
 * lands; the new order is saved for every device.
 */
function SortableProjects({
  projects,
  theme,
  render,
}: {
  projects: readonly TreeProject[];
  theme: PluginTheme;
  render(project: TreeProject, drag: ProjectDrag): ReactNode;
}) {
  const container = useRef<View>(null);
  const nodes = useRef(new Map<string, View | null>());
  const boxes = useRef(new Map<string, Box>());
  const [drag, setDrag] = useState<{ key: string; dy: number; to: number } | null>(null);
  const latest = useRef(projects);
  latest.current = projects;

  const handlers = useRef(new Map<string, ProjectDrag>());
  const handlersFor = (key: string): ProjectDrag => {
    const existing = handlers.current.get(key);
    if (existing) return existing;
    let dy = 0;
    const keys = () => latest.current.map((project) => project.key);
    const target = (offset: number) => {
      const list = keys();
      const from = list.indexOf(key);
      const headings = list.map((candidate) => ({ top: boxes.current.get(candidate)?.top ?? 0, height: PROJECT_HEADING }));
      const top = boxes.current.get(key)?.top ?? 0;
      return { from, to: listDropIndex(headings, from, top + PROJECT_HEADING / 2 + offset) };
    };
    const created: ProjectDrag = {
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
        const store = getStore();
        store.updatePrefs({ projectOrder: moveProject(store.getSnapshot().prefs.projectOrder, keys(), key, to) });
      },
    };
    handlers.current.set(key, created);
    return created;
  };

  // The marker sits above the project that will follow the dropped one, or below the last.
  let marker = 0;
  if (drag) {
    const others = projects.filter((project) => project.key !== drag.key);
    const after = others[drag.to];
    const last = others[others.length - 1];
    const box = after ? boxes.current.get(after.key) : last ? boxes.current.get(last.key) : undefined;
    marker = box ? (after ? box.top : box.top + box.height) : 0;
  }

  return (
    <View ref={container} style={{ position: "relative" }}>
      {projects.map((project) => {
        const dragged = drag?.key === project.key;
        return (
          <View
            key={project.key}
            ref={(node) => {
              nodes.current.set(project.key, node);
            }}
            style={
              dragged
                ? { transform: [{ translateY: drag.dy }], zIndex: 10, opacity: 0.85, backgroundColor: theme.colors.surface1, borderRadius: 8 }
                : null
            }
          >
            {render(project, handlersFor(project.key))}
          </View>
        );
      })}
      {drag ? (
        <View
          pointerEvents="none"
          style={{ position: "absolute", left: 8, right: 8, top: marker - 1, height: 2, borderRadius: 1, backgroundColor: theme.colors.accent }}
        />
      ) : null}
    </View>
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
  renderChat(row: TriageRow): ReactNode;
}) {
  const chats = showOlder ? [...workspace.chats, ...workspace.older] : workspace.chats;
  const kind = show.kind && info ? KIND_LABEL[info.kind] : undefined;
  const fs = useFontScale();
  const small = { fontSize: fs(10.5), color: theme.colors.foregroundMuted };
  const branch = show.branch && (show.mainBranch || !MAIN_BRANCHES[workspace.branch]) ? workspace.branch : "";
  return (
    <View style={{ marginBottom: 2 }}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingRight: 6 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${folded ? "Show" : "Hide"} ${info?.title ?? workspace.name}`}
          accessibilityState={{ expanded: !folded }}
          onPress={() => toggleNode(`${prefix}workspace:${workspace.key}`)}
          style={({ pressed }) => ({
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            gap: 7,
            paddingHorizontal: 10,
            minHeight: compact ? 40 : 26,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          {show.status ? (
            <LedDot led={workspace.led} released={workspace.released} failed={workspace.failed} theme={theme} size={11} />
          ) : null}
          {/* White while something happens in it (running, asking, unseen); grey like its chats otherwise. */}
          <Text
            numberOfLines={1}
            style={{ flex: 1, fontSize: fs(13), color: workspace.led === "idle" ? theme.colors.foregroundMuted : theme.colors.foreground }}
          >
            {info?.title ?? workspace.name}
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
