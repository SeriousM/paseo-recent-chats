import { describe, expect, it } from "vitest";
import { buildTree } from "../client/project-tree";
import { searchTree } from "../client/tree-search";
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
    sortAt: NOW,
    ...change,
  };
}

const tree = buildTree(
  [
    row("plugin changes"),
    row("IDP P2 ExpoPlatform provider", { workspaceId: "w2", workspaceName: "Resume IDP refactor", projectName: "Everything", branch: "chore/idp-refactor" }),
  ],
  [{ id: "h1", label: "desk" }],
  { now: NOW, inactiveWindowDays: 14, activeOnly: false, chatsPerWorkspace: 99, pinnedWorkspaces: new Set() },
);

describe("search over the projects tree", () => {
  it("finds projects, workspaces and chats by fuzzy words", () => {
    expect(searchTree("rcpp", tree).map((hit) => `${hit.kind}:${hit.label}`)).toContain("project:RecentChatsPaseoPlugin");
    expect(searchTree("idp refac", tree)[0]).toMatchObject({ kind: "workspace", label: "Resume IDP refactor", projectKey: "h1:Everything" });
    expect(searchTree("expo", tree)[0]).toMatchObject({ kind: "chat", label: "IDP P2 ExpoPlatform provider" });
  });

  it("finds a workspace by its branch, and nothing for an empty query", () => {
    expect(searchTree("chore", tree).map((hit) => hit.kind)).toContain("workspace");
    expect(searchTree("  ", tree)).toEqual([]);
  });
});
