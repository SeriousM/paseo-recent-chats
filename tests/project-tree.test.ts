import { describe, expect, it } from "vitest";
import { buildTree, foldAll, moveInOrder, pinnedTree } from "../client/project-tree";
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
    released: false,
    failed: false,
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

describe("pinned section", () => {
  // Everything: workspace w1 with chats a-d, workspace w2 with e. Other: workspace w3 with f, old.
  const rows = [
    row("a"),
    row("b", { pinned: true }),
    row("c"),
    row("d", { pinned: true }),
    row("e", { workspaceId: "w2", workspaceName: "mjml" }),
    row("f", { workspaceId: "w3", workspaceName: "audit", projectName: "Other", sortAt: NOW - 30 * DAY }),
  ];
  const full = (pinnedWorkspaces: Set<string>, pinnedProjects: Set<string>) =>
    buildTree(rows, HOSTS, { ...options, activeOnly: false, chatsPerWorkspace: 99, pinnedWorkspaces, pinnedProjects });
  const shape = (hosts: ReturnType<typeof pinnedTree>) =>
    hosts.flatMap((host) => host.projects.map((project) => `${project.name}: ${project.workspaces.map((ws) => `${ws.name}[${ws.chats.map((chat) => chat.agentId).sort().join("")}]`).join(" ")}`));

  it("shows pinned chats with their project and workspace only", () => {
    expect(shape(pinnedTree(full(new Set(), new Set()), new Set()))).toEqual(["Everything: IDP refactor[bd]"]);
  });

  it("brings every chat of a pinned workspace, and everything of a pinned project, even when old", () => {
    const workspaces = new Set(["h1:w2"]);
    const projects = new Set(["h1:Other"]);
    expect(shape(pinnedTree(full(workspaces, projects), projects))).toEqual([
      "Everything: mjml[e] IDP refactor[bd]",
      "Other: audit[f]",
    ]);
  });

  it("keeps a pinned project out of the quiet list in the tree", () => {
    const [host] = buildTree(rows, HOSTS, { ...options, pinnedProjects: new Set(["h1:Other"]) });
    expect(host?.projects.map((project) => project.name)).toContain("Other");
    expect(host?.quiet).toEqual([]);
  });
});

describe("project order", () => {
  const rows = ["delta", "alpha", "charlie", "bravo"].map((name) => row(name, { projectName: name, workspaceId: `w-${name}` }));
  const names = (order: readonly string[]) =>
    buildTree(rows, HOSTS, { ...options, projectOrder: order })[0]?.projects.map((project) => project.name);

  it("lists dragged projects first in their order and the rest by name; unknown keys are ignored", () => {
    expect(names([])).toEqual(["alpha", "bravo", "charlie", "delta"]);
    expect(names(["h1:delta", "h9:gone", "h1:bravo"])).toEqual(["delta", "bravo", "alpha", "charlie"]);
  });

  it("moving a project puts the shown ones in their new order and keeps the others behind", () => {
    const shown = ["h1:alpha", "h1:bravo", "h1:charlie"];
    expect(moveInOrder(["h2:x", "h1:charlie"], shown, "h1:charlie", 0)).toEqual(["h1:charlie", "h1:alpha", "h1:bravo", "h2:x"]);
    expect(moveInOrder([], shown, "h1:alpha", 99)).toEqual(["h1:bravo", "h1:charlie", "h1:alpha"]);
  });

  it("lists dragged workspaces first in their project, then the most recently active", () => {
    const ws = (id: string, ago: number) => row(id, { workspaceId: id, workspaceName: id, sortAt: NOW - ago * HOUR });
    const order = (workspaceOrder: readonly string[]) =>
      buildTree([ws("a", 1), ws("b", 2), ws("c", 3)], HOSTS, { ...options, workspaceOrder })[0]?.projects[0]?.workspaces.map((w) => w.name);
    expect(order([])).toEqual(["a", "b", "c"]);
    expect(order(["h1:c"])).toEqual(["c", "a", "b"]);
  });
});

describe("fold all", () => {
  const rows = [
    row("busy", { projectName: "live", workspaceId: "w1", workspaceName: "on", bucket: "running", led: "running" }),
    row("idle-ws", { projectName: "live", workspaceId: "w2", workspaceName: "off" }),
    row("still", { projectName: "quiet", workspaceId: "w3", workspaceName: "q" }),
  ];
  const tree = buildTree(rows, HOSTS, { ...options, activeOnly: false });
  const kept = ["pinned/project:h1:live", "older:h1:w1", "quiet:h1"];

  it("collapses every project, expands everything, and keeps the Pinned section's, older and quiet folds", () => {
    expect(foldAll(tree, [...kept, "workspace:h1:w1", "host:h1"], "collapse")).toEqual([...kept, "project:h1:live", "project:h1:quiet"]);
    expect(foldAll(tree, [...kept, "project:h1:live"], "expand")).toEqual(kept);
  });

  it("opens only what is active: idle projects folded, idle workspaces of active projects folded", () => {
    expect(foldAll(tree, kept, "active")).toEqual([...kept, "workspace:h1:w2", "project:h1:quiet"]);
  });
});
