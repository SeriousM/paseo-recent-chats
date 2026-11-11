import { describe, expect, it } from "vitest";
import { buildTree } from "../client/project-tree";
import type { TriageRow } from "../client/triage";

const NOW = Date.UTC(2026, 10, 11, 21);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function row(agentId: string, change: Partial<TriageRow> = {}): TriageRow {
  return {
    key: `h1:${agentId}`,
    hostId: "h1",
    hostLabel: "desk",
    agentId,
    workspaceId: "w1",
    projectName: "Everything",
    workspaceName: "IDP refactor",
    branch: "main",
    agentName: "opus-5.5",
    title: agentId,
    provider: "omp",
    bucket: "inactive",
    pinned: false,
    led: "idle",
    sortAt: NOW - HOUR,
    ...change,
  };
}

const HOSTS = [{ id: "h1", label: "desk" }];
const options = { now: NOW, inactiveWindowDays: 3, activeOnly: true, chatsPerWorkspace: 3, pinnedWorkspaces: new Set<string>() };

describe("project tree", () => {
  it("lists a workspace's urgent and pinned chats beyond the per-workspace count, most urgent first", () => {
    const rows = [
      row("old1", { sortAt: NOW - 5 * HOUR }),
      row("old2", { sortAt: NOW - 4 * HOUR }),
      row("old3", { sortAt: NOW - 3 * HOUR }),
      row("old4", { sortAt: NOW - 2 * HOUR }),
      row("pinned", { pinned: true, sortAt: NOW - 30 * DAY }),
      row("asks", { bucket: "unread", led: "permission", sortAt: NOW - 10 * HOUR }),
      row("runs", { bucket: "running", led: "running", sortAt: NOW - 6 * HOUR }),
    ];
    const [host] = buildTree(rows, HOSTS, options);
    const workspace = host?.projects[0]?.workspaces[0];
    // Three chats per workspace, urgent ones included; urgent and pinned ones are listed beyond that.
    expect(workspace?.chats.map((chat) => chat.agentId)).toEqual(["asks", "runs", "old4", "pinned"]);
    expect(workspace?.older.map((chat) => chat.agentId)).toEqual(["old3", "old2", "old1"]);
    expect(workspace?.led).toBe("permission");
    expect(host?.need).toBe(1);
  });

  it("Active only folds projects with nothing inside the window into quiet projects; off lists them", () => {
    const rows = [
      row("fresh"),
      row("stale", { projectName: "azure-ops", workspaceId: "w2", workspaceName: "AKS", sortAt: NOW - 9 * DAY }),
    ];
    const [active] = buildTree(rows, HOSTS, options);
    expect(active?.projects.map((project) => project.name)).toEqual(["Everything"]);
    expect(active?.quiet.map((project) => project.name)).toEqual(["azure-ops"]);
    // A quiet project keeps its workspaces, for when the user unfolds the quiet list.
    expect(active?.quiet[0]?.workspaces[0]?.older.map((chat) => chat.agentId)).toEqual(["stale"]);

    const [all] = buildTree(rows, HOSTS, { ...options, activeOnly: false });
    expect(all?.projects.map((project) => project.name)).toEqual(["azure-ops", "Everything"]);
    expect(all?.quiet).toEqual([]);
  });

  it("puts workspaces pinned in Paseo first and keeps them under Active only", () => {
    const rows = [
      row("recent", { workspaceId: "w1", workspaceName: "busy" }),
      row("ancient", { workspaceId: "w2", workspaceName: "pinned", sortAt: NOW - 40 * DAY }),
    ];
    const [host] = buildTree(rows, HOSTS, { ...options, pinnedWorkspaces: new Set(["h1:w2"]) });
    expect(host?.projects[0]?.workspaces.map((workspace) => [workspace.name, workspace.pinned])).toEqual([
      ["pinned", true],
      ["busy", false],
    ]);
  });

  it("does not count an opened, held chat as needing you", () => {
    const [host] = buildTree([row("held", { bucket: "unread", led: "idle" })], HOSTS, options);
    expect(host?.need).toBe(0);
    expect(host?.projects[0]?.workspaces[0]?.chats.map((chat) => chat.agentId)).toEqual(["held"]);
  });

  it("lists every given host, also one without chats, in the given order", () => {
    const tree = buildTree([row("a")], [{ id: "h2", label: "pi" }, ...HOSTS], options);
    expect(tree.map((host) => [host.label, host.projects.length])).toEqual([
      ["pi", 0],
      ["desk", 1],
    ]);
  });
});
