// Pure grouping for the Projects mode of the sidebar view: host -> project -> workspace -> chat.
// No React, no SDK imports. Works on the triage rows, so lights, read marks and pins match the lists.
import { LED_RANK, type Led, type TriageRow } from "./triage";

const DAY_MS = 86_400_000;

export interface TreeWorkspace {
  /** hostId + workspace id; chats without a workspace group by workspace name. */
  key: string;
  hostId: string;
  workspaceId: string | null;
  name: string;
  branch: string;
  /** Most urgent light of its chats. */
  led: Led;
  /** Pinned in Paseo (a workspace pin, not a chat pin). */
  pinned: boolean;
  /** Newest time any of its chats sorts on. */
  lastAt: number;
  /** Always listed: chats that need you, run or are pinned, then the newest up to the per-workspace count. */
  chats: TriageRow[];
  /** The rest, behind "+N older". */
  older: TriageRow[];
}

export interface TreeProject {
  key: string;
  name: string;
  /** The daemon's project id, where known (always for an empty project). */
  projectId?: string;
  workspaces: TreeWorkspace[];
}

export interface TreeHost {
  hostId: string;
  label: string;
  /** Chats on this host that wait for you or finished unseen. */
  need: number;
  projects: TreeProject[];
  /** Projects with nothing inside the inactive window ("Active only"), each with all its workspaces. */
  quiet: TreeProject[];
}

export interface TreeOptions {
  now: number;
  inactiveWindowDays: number;
  /** Hide workspaces with nothing inside the inactive window; their projects become quiet. */
  activeOnly: boolean;
  /** Chats listed per workspace before "+N older"; urgent and pinned chats are always listed. */
  chatsPerWorkspace: number;
  /** `${hostId}:${workspaceId}` of pinned workspaces. */
  pinnedWorkspaces: ReadonlySet<string>;
  /** `${hostId}:${projectName}` of pinned projects: never quiet. */
  pinnedProjects?: ReadonlySet<string>;
  /** Project keys (`${hostId}:${projectName}`) in the order the user dragged them; the rest follow by name. */
  projectOrder?: readonly string[];
  /** Workspace keys (`${hostId}:${workspaceId}`) in the order the user dragged them inside their project. */
  workspaceOrder?: readonly string[];
  /** Workspaces and projects listed without chats (the Empty filter, see emptyItems). */
  empty?: EmptyItems;
}

interface EmptyItems {
  workspaces: readonly { hostId: string; id: string; projectId: string; treeProject: string; title: string; branch: string }[];
  projects: readonly { hostId: string; id: string; treeProject: string }[];
}

/** For the Empty filter: workspaces no chat is in, and projects no workspace is in. */
export function emptyItems(rows: readonly TriageRow[], all: EmptyItems): EmptyItems {
  const withChats = new Set(rows.map((row) => `${row.hostId}:${row.workspaceId}`));
  const withWorkspaces = new Set(all.workspaces.map((workspace) => `${workspace.hostId}:${workspace.projectId}`));
  return {
    workspaces: all.workspaces.filter((workspace) => !withChats.has(`${workspace.hostId}:${workspace.id}`)),
    projects: all.projects.filter((project) => !withWorkspaces.has(`${project.hostId}:${project.id}`)),
  };
}

/** Collapse every project, expand everything, or open only what is active (see foldAll). */
export type FoldAll = "collapse" | "expand" | "active";

/**
 * The folds after a fold-all action on one section of the view, from the device's switched folds
 * (`toggled`, see view-mode.ts). `prefix` names the section: "" the tree, "pinned/" the Pinned section.
 * Its hosts open; "collapse" folds every project; "active" folds every project and workspace with nothing
 * running, asking you or finished unseen, and opens the rest. Other sections' folds, "+N older" and the
 * quiet lists stay as they are.
 */
export function foldAll(hosts: readonly TreeHost[], toggled: readonly string[], mode: FoldAll, prefix = ""): string[] {
  const kept = toggled.filter((key) => !(key.startsWith(prefix) && /^(project|workspace|host):/.test(key.slice(prefix.length))));
  if (mode === "expand") return kept;
  const folded: string[] = [];
  for (const host of hosts) {
    for (const project of [...host.projects, ...host.quiet]) {
      const busy = project.workspaces.filter((workspace) => workspace.led !== "idle");
      if (mode === "collapse" || busy.length === 0) folded.push(`${prefix}project:${project.key}`);
      else for (const workspace of project.workspaces) if (!busy.includes(workspace)) folded.push(`${prefix}workspace:${workspace.key}`);
    }
  }
  return [...kept, ...folded];
}

/** A chat that waits for you or finished unseen; a held (opened, grey) chat no longer counts. */
export const needsYou = (row: TriageRow): boolean => row.bucket === "unread" && row.led !== "idle";

const names = new Intl.Collator(undefined, { sensitivity: "base" });

export function buildTree(
  rows: readonly TriageRow[],
  hosts: readonly { id: string; label: string }[],
  options: TreeOptions,
): TreeHost[] {
  const windowStart = options.now - options.inactiveWindowDays * DAY_MS;
  const live = (row: TriageRow) => row.bucket !== "inactive" || row.pinned || row.sortAt >= windowStart;
  // host -> project -> workspace key -> rows
  const grouped = new Map<string, Map<string, Map<string, TriageRow[]>>>();
  const projectsOf = (hostId: string) => {
    const projects = grouped.get(hostId) ?? new Map<string, Map<string, TriageRow[]>>();
    grouped.set(hostId, projects);
    return projects;
  };
  const workspacesOf = (hostId: string, project: string) => {
    const projects = projectsOf(hostId);
    const workspaces = projects.get(project) ?? new Map<string, TriageRow[]>();
    projects.set(project, workspaces);
    return workspaces;
  };
  for (const row of rows) {
    const workspaces = workspacesOf(row.hostId, row.projectName);
    const key = `${row.hostId}:${row.workspaceId ?? `name:${row.workspaceName}`}`;
    const list = workspaces.get(key);
    if (list) list.push(row);
    else workspaces.set(key, [row]);
  }
  // Empty workspaces and projects join with no rows; `emptyInfo` names them.
  const emptyInfo = new Map<string, { hostId: string; id: string; title: string; branch: string }>();
  const projectIds = new Map<string, string>();
  if (options.empty) {
    for (const workspace of options.empty.workspaces) {
      const key = `${workspace.hostId}:${workspace.id}`;
      emptyInfo.set(key, workspace);
      workspacesOf(workspace.hostId, workspace.treeProject).set(key, []);
    }
    for (const project of options.empty.projects) {
      workspacesOf(project.hostId, project.treeProject);
      projectIds.set(`${project.hostId}:${project.treeProject}`, project.id);
    }
  }

  const toWorkspace = (key: string, list: TriageRow[]): TreeWorkspace => {
    const info = emptyInfo.get(key);
    if (list.length === 0 && info) {
      const pinned = options.pinnedWorkspaces.has(key);
      return { key, hostId: info.hostId, workspaceId: info.id, name: info.title, branch: info.branch, led: "idle", pinned, lastAt: 0, chats: [], older: [] };
    }
    const sorted = [...list].sort((a, b) => LED_RANK[a.led] - LED_RANK[b.led] || b.sortAt - a.sortAt);
    const chats: TriageRow[] = [];
    const older: TriageRow[] = [];
    for (const row of sorted) {
      const fits = chats.length < options.chatsPerWorkspace && (!options.activeOnly || live(row));
      // Chats that need you, run or are pinned are listed whatever the per-workspace count.
      (row.bucket !== "inactive" || row.pinned || fits ? chats : older).push(row);
    }
    const first = sorted[0] as TriageRow;
    return {
      key,
      hostId: first.hostId,
      workspaceId: first.workspaceId,
      name: first.workspaceName,
      branch: first.branch,
      led: first.led,
      pinned: first.workspaceId !== null && options.pinnedWorkspaces.has(`${first.hostId}:${first.workspaceId}`),
      lastAt: Math.max(...list.map((row) => row.sortAt)),
      chats,
      older,
    };
  };

  return hosts.map(({ id, label }) => {
    const projects: TreeProject[] = [];
    const quiet: TreeProject[] = [];
    let need = 0;
    const workspaceRank = new Map((options.workspaceOrder ?? []).map((key, index) => [key, index]));
    for (const [name, workspaces] of grouped.get(id) ?? []) {
      // Dragged workspaces first in their order; then pinned ones, then the most recently active.
      const all = [...workspaces]
        .map(([key, list]) => toWorkspace(key, list))
        .sort(
          (a, b) =>
            (workspaceRank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (workspaceRank.get(b.key) ?? Number.MAX_SAFE_INTEGER) ||
            Number(b.pinned) - Number(a.pinned) ||
            b.lastAt - a.lastAt ||
            a.key.localeCompare(b.key),
        );
      for (const workspace of all) need += [...workspace.chats, ...workspace.older].filter(needsYou).length;
      const key = `${id}:${name}`;
      const projectPinned = options.pinnedProjects?.has(key) ?? false;
      const shown = options.activeOnly && !projectPinned ? all.filter((w) => w.pinned || w.chats.some(live)) : all;
      const projectId = projectIds.get(key);
      if (shown.length > 0 || all.length === 0) projects.push({ key, name, projectId, workspaces: shown });
      else quiet.push({ key, name, projectId, workspaces: all });
    }
    const byOrder = projectComparator(options.projectOrder ?? []);
    return { hostId: id, label, need, projects: projects.sort(byOrder), quiet: quiet.sort(byOrder) };
  });
}

/** Projects listed in `order` first, in that order; the others after them by name. */
export function projectComparator(order: readonly string[]): (a: TreeProject, b: TreeProject) => number {
  const rank = new Map(order.map((key, index) => [key, index]));
  return (a, b) =>
    (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER) || names.compare(a.name, b.name);
}

/**
 * A stored order (of projects or workspaces) after dragging `key` to position `to` among the items on
 * screen (`shown`, in their current order). The shown items take that order at the front; items not on
 * screen (another host or project, folded away as quiet) keep their stored order behind them.
 */
export function moveInOrder(order: readonly string[], shown: readonly string[], key: string, to: number): string[] {
  const moved = shown.filter((candidate) => candidate !== key);
  moved.splice(Math.max(0, Math.min(to, moved.length)), 0, key);
  return [...moved, ...order.filter((candidate) => !moved.includes(candidate))];
}

/**
 * The Pinned section from a tree built with `activeOnly: false`: every pinned item with its parents
 * (for context) and everything below it. A pinned project brings all its workspaces and chats, a
 * pinned workspace all its chats, a pinned chat itself. Hosts and projects without pins are left out.
 */
export function pinnedTree(full: readonly TreeHost[], pinnedProjects: ReadonlySet<string>): TreeHost[] {
  const result: TreeHost[] = [];
  for (const host of full) {
    const projects: TreeProject[] = [];
    for (const project of [...host.projects, ...host.quiet]) {
      const projectPinned = pinnedProjects.has(project.key);
      const workspaces: TreeWorkspace[] = [];
      for (const workspace of project.workspaces) {
        const every = [...workspace.chats, ...workspace.older];
        const chats = projectPinned || workspace.pinned ? every : every.filter((row) => row.pinned);
        if (chats.length || projectPinned || workspace.pinned) workspaces.push({ ...workspace, chats, older: [] });
      }
      if (workspaces.length) projects.push({ ...project, workspaces });
    }
    if (projects.length) result.push({ ...host, need: 0, projects, quiet: [] });
  }
  return result;
}
