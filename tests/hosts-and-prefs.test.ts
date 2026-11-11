import { describe, expect, it } from "vitest";
import { DEFAULT_PREFS, parseStoredPrefs, toggleHiddenHost } from "../client/prefs";
import { buildTriage, type ChatInput, type TriageLimits } from "../client/triage";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const MIN = 60_000;
const ago = (minutes: number) => NOW - minutes * MIN;

const limits: TriageLimits = {
  maxUnread: 2,
  maxRunning: 1,
  maxInactive: 1,
  inactiveWindowDays: 14,
  unreadExpiryDays: 7,
};

function chat(hostId: string, id: string, patch: Partial<ChatInput> = {}): ChatInput {
  return {
    hostId,
    hostLabel: hostId.toUpperCase(),
    agentId: id,
    workspaceId: "w",
    projectName: "p",
    workspaceName: "w",
    branch: "main",
    agentName: "opus",
    title: id,
    provider: "omp",
    status: "idle",
    startedAt: null,
    lastUserMessageAt: ago(10),
    updatedAt: ago(10),
    attention: null,
    ...patch,
  };
}

const unread = (minutes: number) => ({ reason: "finished" as const, at: ago(minutes) });
const ids = (rows: { agentId: string }[]) => rows.map((row) => row.agentId);

describe("grouping by host", () => {
  const chats = [
    chat("b", "b-old", { attention: unread(50) }),
    chat("a", "a-new", { attention: unread(5) }),
    chat("a", "a-old", { attention: unread(40) }),
    chat("a", "a-mid", { attention: unread(20) }),
    chat("b", "b-run", { status: "running", startedAt: ago(3) }),
    chat("a", "a-idle"),
  ];

  it("keeps each host's chats together, in the given host order, with the usual order inside", () => {
    const result = buildTriage(chats, {}, limits, NOW, { groupByHost: true, hostOrder: ["b", "a"] });
    expect(ids(result.rows)).toEqual(["b-old", "b-run", "a-old", "a-mid", "a-idle"]);
  });

  it("applies the caps per host and adds up what is hidden", () => {
    const result = buildTriage(chats, {}, limits, NOW, { groupByHost: true, hostOrder: ["a", "b"] });
    expect(ids(result.rows.filter((row) => row.hostId === "a"))).toEqual(["a-old", "a-mid", "a-idle"]);
    expect(result.hidden).toEqual({ unread: 1, running: 0, inactive: 0 });
    expect(result.counts).toEqual({ unread: 4, running: 1, inactive: 1 });
  });

  it("without grouping the cap is global and rows are mixed across hosts", () => {
    const result = buildTriage(chats, {}, limits, NOW);
    expect(ids(result.rows)).toEqual(["b-old", "a-old", "b-run", "a-idle"]);
    expect(result.hidden.unread).toBe(2);
  });

  it("orders hosts missing from the host order after the listed ones, by label", () => {
    const result = buildTriage(
      [chat("z", "z1"), chat("m", "m1"), chat("a", "a1")],
      {},
      limits,
      NOW,
      { groupByHost: true, hostOrder: ["z"] },
    );
    expect(ids(result.all)).toEqual(["z1", "a1", "m1"]);
  });

  it("reports the worst unread colour across hosts", () => {
    const result = buildTriage(
      [
        chat("a", "a1", { attention: unread(5) }),
        chat("b", "b1", { attention: { reason: "permission", at: ago(1) } }),
      ],
      {},
      limits,
      NOW,
      { groupByHost: true },
    );
    expect(result.worstUnread).toBe("permission");
  });

  it("gives an empty result for no chats", () => {
    const result = buildTriage([], {}, limits, NOW, { groupByHost: true });
    expect(result.rows).toEqual([]);
    expect(result.worstUnread).toBeNull();
  });
});

describe("stored preferences", () => {
  it("defaults: all hosts on, not grouped", () => {
    expect(DEFAULT_PREFS.groupByHost).toBe(false);
    expect(DEFAULT_PREFS.hiddenHosts).toEqual([]);
  });

  it("round-trips through JSON", () => {
    const changed = { ...DEFAULT_PREFS, groupByHost: true, hiddenHosts: ["x"], maxUnread: 9 };
    expect(parseStoredPrefs(JSON.stringify(changed))).toEqual(changed);
  });

  it("fills fields an older version did not have", () => {
    const old = JSON.stringify({ maxUnread: 8, layout: [{ id: "title", enabled: true, line: 1, maxChars: 0 }] });
    const parsed = parseStoredPrefs(old);
    expect(parsed?.maxUnread).toBe(8);
    expect(parsed?.groupByHost).toBe(false);
    expect(parsed?.hiddenHosts).toEqual([]);
    // Missing row items are added, switched off.
    expect(parsed?.layout.map((token) => token.id)).toEqual(["title", "host", "led", "project", "workspace", "branch", "agent", "age"]);
    expect(parsed?.layout.filter((token) => token.enabled).map((token) => token.id)).toEqual(["title"]);
  });

  it("rejects missing, broken and invalid values", () => {
    expect(parseStoredPrefs(null)).toBeNull();
    expect(parseStoredPrefs("")).toBeNull();
    expect(parseStoredPrefs("{not json")).toBeNull();
    expect(parseStoredPrefs(JSON.stringify({ maxUnread: 0 }))).toBeNull();
    expect(parseStoredPrefs(JSON.stringify({ hiddenHosts: "a" }))).toBeNull();
  });
});

describe("host filter", () => {
  it("switches a host off and on again", () => {
    const off = toggleHiddenHost([], "b", ["a", "b"]);
    expect(off).toEqual(["b"]);
    expect(toggleHiddenHost(off, "b", ["a", "b"])).toEqual([]);
  });

  it("keeps other switched-off hosts and drops ids of hosts that no longer exist", () => {
    expect(toggleHiddenHost(["a", "gone"], "b", ["a", "b"])).toEqual(["a", "b"]);
  });
});
