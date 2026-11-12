import { describe, expect, it } from "vitest";
import { fuzzyScore, scoreRow, searchRows } from "../client/fuzzy";
import { withAlpha } from "../client/format";
import type { TriageRow } from "../client/triage";

function row(id: string, patch: Partial<TriageRow> = {}): TriageRow {
  return {
    key: `h:${id}`,
    hostId: "h",
    hostLabel: "laptop",
    agentId: id,
    workspaceId: null,
    projectName: "proj",
    workspaceName: "ws",
    branch: "main",
    agentName: "opus-5.5",
    title: id,
    provider: "omp",
    bucket: "inactive",
    pinned: false,
    led: "idle",
    released: false,
    failed: false,
    sortAt: 1,
    ...patch,
  };
}

describe("fuzzyScore", () => {
  it("matches characters in order and rejects the rest", () => {
    expect(fuzzyScore("plg", "paseo plugin")).not.toBeNull();
    expect(fuzzyScore("gpl", "paseo plugin")).toBeNull();
    expect(fuzzyScore("xyz", "paseo plugin")).toBeNull();
  });

  it("is case-insensitive and treats camel-case humps as word starts", () => {
    expect(fuzzyScore("mhm", "MultiHostManagerPaseoPlugin")).not.toBeNull();
    const hump = fuzzyScore("mhm", "MultiHostManager")!;
    const buried = fuzzyScore("mhm", "something here made")!;
    expect(hump).toBeGreaterThan(buried);
  });

  it("scores a prefix above a match in the middle and an exact word above a scattered one", () => {
    expect(fuzzyScore("rec", "recent chats")!).toBeGreaterThan(fuzzyScore("rec", "the sprecher")!);
    expect(fuzzyScore("chat", "recent chats")!).toBeGreaterThan(fuzzyScore("chat", "cool hat apple tree")!);
  });

  it("rejects scattered matches that are too loose", () => {
    expect(fuzzyScore("abc", "xaxxxxxxxxxxxxxxxxxxbxxxxxxxxxxxxxxxxxxcx")).toBeNull();
  });

  it("matches an empty query and rejects a query longer than the text", () => {
    expect(fuzzyScore("", "anything")).toBe(0);
    expect(fuzzyScore("longer", "abc")).toBeNull();
  });

  it("handles non-ASCII text", () => {
    expect(fuzzyScore("ärg", "Ünïcode Ärger")).not.toBeNull();
  });
});

describe("scoreRow and searchRows", () => {
  const rows = [
    row("1", { title: "Fix flaky relay test", projectName: "paseo-core", branch: "feature/relay" }),
    row("2", { title: "Write release notes", projectName: "sqlite-studio", branch: "main" }),
    row("3", { title: "Review work items", projectName: "azdevops-plugin", branch: "task-12" }),
  ];

  it("requires every word to match some field, in any field", () => {
    expect(scoreRow("relay core", rows[0]!)).not.toBeNull();
    expect(scoreRow("relay sqlite", rows[0]!)).toBeNull();
    expect(scoreRow("   ", rows[0]!)).toBe(0);
  });

  it("finds a chat through its project, branch, agent or host", () => {
    expect(searchRows("sqlite", rows).map((r) => r.agentId)).toEqual(["2"]);
    expect(searchRows("task-12", rows).map((r) => r.agentId)).toEqual(["3"]);
    expect(searchRows("opus", rows)).toHaveLength(3);
    expect(searchRows("laptop", rows)).toHaveLength(3);
  });

  it("ranks the better match first and keeps incoming order for ties", () => {
    const list = [row("a", { title: "xx relay yy" }), row("b", { title: "relay" }), row("c", { title: "relay" })];
    expect(searchRows("relay", list).map((r) => r.agentId)).toEqual(["b", "c", "a"]);
  });

  it("returns everything for an empty query and nothing for no match", () => {
    expect(searchRows("", rows)).toHaveLength(3);
    expect(searchRows("zzzzqq", rows)).toEqual([]);
  });
});

describe("withAlpha", () => {
  it("turns hex colours into rgba", () => {
    expect(withAlpha("#ff8000", 0.5)).toBe("rgba(255, 128, 0, 0.5)");
    expect(withAlpha("#f80", 1)).toBe("rgba(255, 136, 0, 1)");
  });
  it("clamps alpha and leaves other formats alone", () => {
    expect(withAlpha("#000000", 4)).toBe("rgba(0, 0, 0, 1)");
    expect(withAlpha("#000000", -1)).toBe("rgba(0, 0, 0, 0)");
    expect(withAlpha("rgb(1,2,3)", 0.5)).toBe("rgb(1,2,3)");
  });
});
