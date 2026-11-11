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
  /** `${hostId}:${workspaceId}` of workspaces pinned in Paseo. */
  pinnedWorkspaces: ReadonlySet<string>;
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
  for (const row of rows) {
    const projects = grouped.get(row.hostId) ?? new Map<string, Map<string, TriageRow[]>>();
    grouped.set(row.hostId, projects);
    const workspaces = projects.get(row.projectName) ?? new Map<string, TriageRow[]>();
    projects.set(row.projectName, workspaces);
    const key = `${row.hostId}:${row.workspaceId ?? `name:${row.workspaceName}`}`;
    const list = workspaces.get(key);
    if (list) list.push(row);
    else workspaces.set(key, [row]);
  }

  const toWorkspace = (key: string, list: TriageRow[]): TreeWorkspace => {
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
    for (const [name, workspaces] of grouped.get(id) ?? []) {
      const all = [...workspaces]
        .map(([key, list]) => toWorkspace(key, list))
        .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.lastAt - a.lastAt || a.key.localeCompare(b.key));
      for (const workspace of all) need += [...workspace.chats, ...workspace.older].filter(needsYou).length;
      const shown = options.activeOnly ? all.filter((w) => w.pinned || w.chats.some(live)) : all;
      const key = `${id}:${name}`;
      if (shown.length > 0) projects.push({ key, name, workspaces: shown });
      else quiet.push({ key, name, workspaces: all });
    }
    const byName = (a: TreeProject, b: TreeProject) => names.compare(a.name, b.name);
    return { hostId: id, label, need, projects: projects.sort(byName), quiet: quiet.sort(byName) };
  });
}
