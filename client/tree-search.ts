// Pure: filters the projects tree by a fuzzy query, keeping how it is drawn. A matching project keeps
// all its workspaces and chats, a matching workspace (name or branch) all its chats, a matching chat
// itself; parents always stay. Every word of the query must match somewhere in the item.
import { fuzzyScore, scoreRow } from "./fuzzy";
import type { TreeHost, TreeProject, TreeWorkspace } from "./project-tree";

function matches(query: string, fields: readonly string[]): boolean {
  const words = query.trim().split(/\s+/).filter(Boolean);
  return words.every((word) => fields.some((field) => fuzzyScore(word, field) !== null));
}

/** Pass the full tree (not "active only"); what matches comes back with nothing behind "+N older". */
export function filterTree(hosts: readonly TreeHost[], query: string): TreeHost[] {
  if (!query.trim()) return [...hosts];
  const result: TreeHost[] = [];
  for (const host of hosts) {
    const projects: TreeProject[] = [];
    for (const project of [...host.projects, ...host.quiet]) {
      const projectHit = matches(query, [project.name]);
      const workspaces: TreeWorkspace[] = [];
      for (const workspace of project.workspaces) {
        const every = [...workspace.chats, ...workspace.older];
        const chats =
          projectHit || matches(query, [workspace.name, workspace.branch])
            ? every
            : every.filter((row) => scoreRow(query, row) !== null);
        if (chats.length) workspaces.push({ ...workspace, chats, older: [] });
      }
      if (workspaces.length) projects.push({ ...project, workspaces });
    }
    if (projects.length) result.push({ ...host, projects, quiet: [] });
  }
  return result;
}
