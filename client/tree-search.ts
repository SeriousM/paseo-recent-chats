// Pure: fuzzy search over everything the projects view shows, projects, workspaces and chats, so a
// result can be jumped to. Every word of the query must match (fuzzily) somewhere in the item.
import { fuzzyScore, scoreRow } from "./fuzzy";
import type { TreeHost } from "./project-tree";
import type { TriageRow } from "./triage";

export type TreeHit =
  | { kind: "project"; key: string; hostId: string; projectKey: string; label: string; detail: string; score: number }
  | { kind: "workspace"; key: string; hostId: string; projectKey: string; workspaceKey: string; label: string; detail: string; score: number }
  | { kind: "chat"; key: string; row: TriageRow; label: string; detail: string; score: number };

/** Projects and workspaces rank slightly above chats with the same score: there are fewer of them. */
const PLACE_BONUS = 1.1;

function scoreFields(query: string, fields: readonly string[]): number | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  let total = 0;
  for (const word of words) {
    let best: number | null = null;
    for (const field of fields) {
      const score = fuzzyScore(word, field);
      if (score !== null && (best === null || score > best)) best = score;
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

/** Best matches first; at most `limit`. `hosts` should be the full tree (not "active only"). */
export function searchTree(query: string, hosts: readonly TreeHost[], limit = 20): TreeHit[] {
  if (!query.trim()) return [];
  const hits: TreeHit[] = [];
  for (const host of hosts) {
    for (const project of [...host.projects, ...host.quiet]) {
      const projectScore = scoreFields(query, [project.name]);
      if (projectScore !== null) {
        hits.push({
          kind: "project",
          key: `project:${project.key}`,
          hostId: host.hostId,
          projectKey: project.key,
          label: project.name,
          detail: host.label,
          score: projectScore * PLACE_BONUS,
        });
      }
      for (const workspace of project.workspaces) {
        const workspaceScore = scoreFields(query, [workspace.name, workspace.branch, project.name]);
        if (workspaceScore !== null) {
          hits.push({
            kind: "workspace",
            key: `workspace:${workspace.key}`,
            hostId: host.hostId,
            projectKey: project.key,
            workspaceKey: workspace.key,
            label: workspace.name,
            detail: `${host.label} \u00B7 ${project.name}${workspace.branch ? ` \u00B7 ${workspace.branch}` : ""}`,
            score: workspaceScore * PLACE_BONUS,
          });
        }
        for (const row of [...workspace.chats, ...workspace.older]) {
          const chatScore = scoreRow(query, row);
          if (chatScore !== null) {
            hits.push({
              kind: "chat",
              key: `chat:${row.key}`,
              row,
              label: row.title ?? row.agentId,
              detail: `${host.label} \u00B7 ${project.name} \u00B7 ${workspace.name}`,
              score: chatScore,
            });
          }
        }
      }
    }
  }
  return hits.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, limit);
}
