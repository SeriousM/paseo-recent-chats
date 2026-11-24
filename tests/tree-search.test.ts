import { describe, expect, it } from "vitest";
import { buildTree } from "../client/project-tree";
import { filterTree } from "../client/tree-search";
import type { TriageRow } from "../client/triage";

const NOW = Date.UTC(2026, 10, 12, 9);

function row(agentId: string, change: Partial<TriageRow> = {}): TriageRow {
  return {
    key: `h1:${agentId}`,
    hostId: "h1",
    hostLabel: "desk",
    agentId,
    workspaceId: "w1",
    projectName: "RecentChatsPaseoPlugin",
    workspaceName: "Plan recent chats",
    branch: "main",
    agentName: "opus-5.5",
    title: agentId,
    provider: "omp",
    bucket: "inactive",
    pinned: false,
    led: "idle",
    released: false,
    failed: false,
    sortAt: NOW,
    ...change,
  };
}

const idp = { workspaceId: "w2", workspaceName: "Resume IDP refactor", projectName: "Everything", branch: "chore/idp-refactor" };
const tree = buildTree(
  [row("plugin changes"), row("pill colours"), row("IDP P2 ExpoPlatform provider", idp), row("IDP P3 Aditus", idp)],
  [{ id: "h1", label: "desk" }],
  { now: NOW, inactiveWindowDays: 14, activeOnly: false, chatsPerWorkspace: 1, pinnedWorkspaces: new Set() },
);

const shape = (hosts: ReturnType<typeof filterTree>) =>
  hosts.flatMap((host) =>
    host.projects.map((project) => `${project.name}: ${project.workspaces.map((ws) => `${ws.name}[${ws.chats.map((chat) => chat.agentId).sort().join(", ")}]`).join(" ")}`),
  );

describe("filtering the projects tree", () => {
  it("keeps a matching chat with its parents only", () => {
    expect(shape(filterTree(tree, "expo"))).toEqual(["Everything: Resume IDP refactor[IDP P2 ExpoPlatform provider]"]);
  });

  it("keeps everything below a matching workspace or project, including what was behind +N older", () => {
    expect(shape(filterTree(tree, "idp refac"))).toEqual(["Everything: Resume IDP refactor[IDP P2 ExpoPlatform provider, IDP P3 Aditus]"]);
    expect(shape(filterTree(tree, "rcpp"))).toEqual(["RecentChatsPaseoPlugin: Plan recent chats[pill colours, plugin changes]"]);
  });

  it("finds a workspace by its branch, and leaves the tree alone for an empty query", () => {
    expect(shape(filterTree(tree, "chore"))).toHaveLength(1);
    expect(filterTree(tree, "  ")).toEqual(tree);
  });
});

describe("empty items", () => {
  const withEmpty = buildTree([row("plugin changes")], [{ id: "h1", label: "desk" }], {
    now: NOW,
    inactiveWindowDays: 14,
    activeOnly: false,
    chatsPerWorkspace: 1,
    pinnedWorkspaces: new Set(),
    empty: {
      workspaces: [{ hostId: "h1", id: "w9", projectId: "p1", treeProject: "RecentChatsPaseoPlugin", title: "Spare", branch: "spare" }],
      projects: [{ hostId: "h1", id: "p2", treeProject: "AzureDevOpsDeploymentCenterWeb" }],
    },
  });

  it("finds a project without workspaces and a workspace without chats by name", () => {
    expect(shape(filterTree(withEmpty, "azuredevops"))).toEqual(["AzureDevOpsDeploymentCenterWeb: "]);
    expect(shape(filterTree(withEmpty, "spare"))).toEqual(["RecentChatsPaseoPlugin: Spare[]"]);
  });

  it("leaves them out when only a chat matches", () => {
    expect(shape(filterTree(withEmpty, "plugin changes"))).toEqual(["RecentChatsPaseoPlugin: Plan recent chats[plugin changes]"]);
  });
});

describe("terminals", () => {
  const term = (id: string, workspaceId: string, title: string) => ({ key: `h1:terminal:${id}`, hostId: "h1", id, workspaceId, title });
  const workspaces = [{ hostId: "h1", id: "w9", projectId: "p9", treeProject: "Ops", title: "Shell only", branch: "" }];
  const withTerminals = buildTree([row("plugin changes")], [{ id: "h1", label: "desk" }], {
    now: NOW,
    inactiveWindowDays: 14,
    activeOnly: true,
    chatsPerWorkspace: 1,
    pinnedWorkspaces: new Set(),
    terminals: [term("t1", "w1", "dev server"), term("t2", "w9", "d8402e39 logs")],
    workspaces,
  });
  const terminalsShape = (hosts: ReturnType<typeof filterTree>) =>
    hosts.flatMap((host) => host.projects.flatMap((project) => project.workspaces.map((ws) => `${project.name}/${ws.name}: ${ws.terminals.map((t) => t.title).join(", ")}`)));

  it("are listed under their workspace; a workspace with only terminals is listed and counts as active", () => {
    expect(terminalsShape(withTerminals)).toEqual(["Ops/Shell only: d8402e39 logs", "RecentChatsPaseoPlugin/Plan recent chats: dev server"]);
  });

  it("are found by their title, with their parents only", () => {
    expect(terminalsShape(filterTree(withTerminals, "d8402e39"))).toEqual(["Ops/Shell only: d8402e39 logs"]);
    expect(shape(filterTree(withTerminals, "dev server"))).toEqual(["RecentChatsPaseoPlugin: Plan recent chats[]"]);
  });
});
