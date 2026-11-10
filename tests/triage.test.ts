import { describe, expect, it } from "vitest";
import { chatTitle, ellipsize, hostColors, parseHostColorNames } from "../client/format";
import { markRead, markUnread, pinChat, pruneOverlay, unpinChat } from "../client/overlay";
import {
  buildTriage,
  chatKey,
  isDelegated,
  nextUp,
  type ChatInput,
  type Overlay,
  type TriageLimits,
} from "../client/triage";
import { prefsSettings } from "../shared/settings";

const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);
const MIN = 60_000;
const DAY = 86_400_000;
const ago = (ms: number) => NOW - ms;

const limits: TriageLimits = {
  maxUnread: 3,
  maxRunning: 2,
  maxInactive: 2,
  inactiveWindowDays: 14,
  unreadExpiryDays: 7,
};

function chat(id: string, patch: Partial<ChatInput> = {}): ChatInput {
  return {
    hostId: "h1",
    hostLabel: "laptop",
    agentId: id,
    workspaceId: "w1",
    projectName: "proj",
    workspaceName: "ws",
    branch: "main",
    agentName: "opus",
    title: `chat ${id}`,
    provider: "claude",
    status: "idle",
    startedAt: null,
    lastUserMessageAt: ago(10 * MIN),
    updatedAt: ago(10 * MIN),
    attention: null,
    ...patch,
  };
}

const attention = (minutesAgo: number, reason: "finished" | "error" | "permission" = "finished") => ({
  reason,
  at: ago(minutesAgo * MIN),
});

const ids = (rows: { agentId: string }[]) => rows.map((row) => row.agentId);

describe("section order", () => {
  const chats = [
    chat("idle"),
    chat("run", { status: "running", startedAt: ago(2 * MIN) }),
    chat("new", { attention: attention(1) }),
    chat("pin"),
  ];
  const overlay: Overlay = { "h1:pin": { pinnedAt: ago(1 * MIN) } };

  it("lists the sections in the chosen order, in the capped list and in all", () => {
    const result = buildTriage(chats, overlay, limits, NOW, { sectionOrder: ["inactive", "running", "unread", "pinned"] });
    expect(ids(result.rows)).toEqual(["idle", "run", "new", "pin"]);
    expect(ids(result.all)).toEqual(["idle", "run", "new", "pin"]);
  });

  it("keeps pinned, needs you, running, inactive without a chosen order, also per host", () => {
    expect(ids(buildTriage(chats, overlay, limits, NOW).rows)).toEqual(["pin", "new", "run", "idle"]);
    const grouped = buildTriage(chats, overlay, limits, NOW, { groupByHost: true, sectionOrder: ["running", "pinned", "unread", "inactive"] });
    expect(ids(grouped.rows)).toEqual(["run", "pin", "new", "idle"]);
  });

  it("accepts only an order naming every section once, and defaults the rest", () => {
    const schema = prefsSettings.schema;
    expect(schema.parse({}).sectionOrder).toEqual(["pinned", "unread", "running", "inactive"]);
    expect(schema.safeParse({ sectionOrder: ["pinned", "pinned", "running", "inactive"] }).success).toBe(false);
    expect(schema.safeParse({ sectionOrder: ["pinned", "unread", "running"] }).success).toBe(false);
  });
});

describe("buckets and ordering", () => {
  it("orders oldest unread, oldest running, newest inactive", () => {
    const result = buildTriage(
      [
        chat("idle-old", { lastUserMessageAt: ago(5 * 60 * MIN) }),
        chat("idle-new", { lastUserMessageAt: ago(1 * MIN) }),
        chat("run-new", { status: "running", startedAt: ago(2 * MIN) }),
        chat("run-old", { status: "running", startedAt: ago(30 * MIN) }),
        chat("unread-new", { attention: attention(5) }),
        chat("unread-old", { attention: attention(50) }),
      ],
      {},
      { ...limits, maxUnread: 9, maxRunning: 9, maxInactive: 9 },
      NOW,
    );
    expect(ids(result.rows)).toEqual([
      "unread-old",
      "unread-new",
      "run-old",
      "run-new",
      "idle-new",
      "idle-old",
    ]);
  });

  it("treats a running chat blocked on permission as unread", () => {
    const result = buildTriage(
      [chat("blocked", { status: "running", startedAt: ago(5 * MIN), attention: attention(1, "permission") })],
      {},
      limits,
      NOW,
    );
    expect(result.rows[0]).toMatchObject({ bucket: "unread", led: "permission" });
    expect(result.counts).toEqual({ unread: 1, running: 0, inactive: 0 });
  });

  it("a chat that finished earlier and now works again is running, not unread", () => {
    for (const reason of ["finished", "error"] as const) {
      const result = buildTriage(
        [chat("resumed", { status: "running", startedAt: ago(1 * MIN), attention: attention(30, reason) })],
        {},
        limits,
        NOW,
      );
      expect(result.rows[0]).toMatchObject({ bucket: "running", led: "running" });
      expect(result.counts).toEqual({ unread: 0, running: 1, inactive: 0 });
      expect(result.worstUnread).toBeNull();
    }
  });

  it("a running chat with a Later mark shows as running and is unread again when it stops", () => {
    const later = markUnread({}, "h1:a", ago(5 * MIN));
    const running = chat("a", { status: "running", startedAt: ago(1 * MIN) });
    expect(buildTriage([running], later, limits, NOW).rows[0]?.bucket).toBe("running");
    expect(buildTriage([{ ...running, status: "idle", startedAt: null }], later, limits, NOW).rows[0]?.bucket).toBe("unread");
  });

  it("a chat that finishes its new turn is unread again, with the new time", () => {
    const stopped = chat("a", { attention: attention(1) });
    expect(buildTriage([stopped], {}, limits, NOW).rows[0]).toMatchObject({ bucket: "unread", sortAt: ago(1 * MIN) });
  });

  it("maps attention reasons to LEDs and reports the worst unread", () => {
    const result = buildTriage(
      [
        chat("a", { attention: attention(3, "finished") }),
        chat("b", { attention: attention(2, "error") }),
        chat("c", { attention: { reason: null, at: ago(1 * MIN) } }),
      ],
      {},
      limits,
      NOW,
    );
    expect(result.rows.map((row) => row.led)).toEqual(["finished", "error", "finished"]);
    expect(result.worstUnread).toBe("error");
  });

  it("breaks ties by host then agent id", () => {
    const at = ago(5 * MIN);
    const result = buildTriage(
      [
        chat("b", { hostId: "h2", attention: { reason: "finished", at } }),
        chat("z", { hostId: "h1", attention: { reason: "finished", at } }),
        chat("a", { hostId: "h1", attention: { reason: "finished", at } }),
      ],
      {},
      limits,
      NOW,
    );
    expect(result.rows.map((row) => chatKey(row.hostId, row.agentId))).toEqual(["h1:a", "h1:z", "h2:b"]);
  });

  it("falls back to updatedAt and startedAt when timestamps are missing", () => {
    const result = buildTriage(
      [
        chat("fresh-idle", { lastUserMessageAt: null, updatedAt: ago(1 * MIN) }),
        chat("run", { status: "running", startedAt: null, updatedAt: ago(9 * MIN) }),
      ],
      {},
      limits,
      NOW,
    );
    expect(result.rows.find((row) => row.agentId === "fresh-idle")?.sortAt).toBe(ago(1 * MIN));
    expect(result.rows.find((row) => row.agentId === "run")?.sortAt).toBe(ago(9 * MIN));
  });
});

describe("caps", () => {
  const many = [
    ...Array.from({ length: 5 }, (_, i) => chat(`u${i}`, { attention: attention(100 - i) })),
    ...Array.from({ length: 4 }, (_, i) => chat(`r${i}`, { status: "running", startedAt: ago((50 - i) * MIN) })),
    ...Array.from({ length: 6 }, (_, i) => chat(`i${i}`, { lastUserMessageAt: ago((10 + i) * MIN) })),
  ];

  it("caps each bucket independently and reports hidden counts", () => {
    const result = buildTriage(many, {}, limits, NOW);
    expect(ids(result.rows)).toEqual(["u0", "u1", "u2", "r0", "r1", "i0", "i1"]);
    expect(result.hidden).toEqual({ unread: 2, running: 2, inactive: 4 });
    expect(result.counts).toEqual({ unread: 5, running: 4, inactive: 6 });
    expect(result.all).toHaveLength(15);
  });

  it("keeps the oldest unread, so the newest unread is what gets hidden", () => {
    const result = buildTriage(many, {}, limits, NOW);
    expect(ids(result.rows.filter((row) => row.bucket === "unread"))).toEqual(["u0", "u1", "u2"]);
  });

  it("allows a zero inactive cap", () => {
    const result = buildTriage(many, {}, { ...limits, maxInactive: 0 }, NOW);
    expect(result.rows.some((row) => row.bucket === "inactive")).toBe(false);
  });

  it("allows a zero running cap and still counts the hidden running chats", () => {
    const result = buildTriage(many, {}, { ...limits, maxRunning: 0 }, NOW);
    expect(result.rows.some((row) => row.bucket === "running")).toBe(false);
    expect(result.hidden.running).toBe(4);
    expect(result.counts.running).toBe(4);
  });

  it("leaves chats older than the window out of the capped list but not out of all", () => {
    const result = buildTriage(
      [chat("old", { lastUserMessageAt: ago(20 * DAY) }), chat("new", { lastUserMessageAt: ago(1 * DAY) })],
      {},
      limits,
      NOW,
    );
    expect(ids(result.rows)).toEqual(["new"]);
    expect(ids(result.all)).toEqual(["new", "old"]);
    expect(result.hidden.inactive).toBe(0);
  });
});

describe("overlay", () => {
  it("a dismissal newer than the attention makes the chat read", () => {
    const overlay: Overlay = { "h1:a": { dismissedAt: ago(1 * MIN) } };
    const result = buildTriage([chat("a", { attention: attention(5) })], overlay, limits, NOW);
    expect(result.rows[0]?.bucket).toBe("inactive");
  });

  it("new attention after a dismissal makes the chat unread again", () => {
    const overlay: Overlay = { "h1:a": { dismissedAt: ago(10 * MIN) } };
    const result = buildTriage([chat("a", { attention: attention(2) })], overlay, limits, NOW);
    expect(result.rows[0]?.bucket).toBe("unread");
  });

  it("Later makes an idle chat unread and sorts it by the mark time", () => {
    const overlay: Overlay = { "h1:later": { unreadAt: ago(1 * MIN) } };
    const result = buildTriage(
      [chat("later"), chat("native", { attention: attention(20) })],
      overlay,
      limits,
      NOW,
    );
    expect(ids(result.rows)).toEqual(["native", "later"]);
    expect(result.rows[1]).toMatchObject({ bucket: "unread", led: "finished" });
  });

  it("opening after Later clears it", () => {
    const marked = markUnread({}, "h1:a", ago(5 * MIN));
    const opened = markRead(marked, ["h1:a"], ago(1 * MIN));
    expect(buildTriage([chat("a")], opened, limits, NOW).rows[0]?.bucket).toBe("inactive");
  });

  it("Later keeps native attention's urgency colour and uses the older timestamp", () => {
    const overlay: Overlay = { "h1:a": { unreadAt: ago(1 * MIN) } };
    const result = buildTriage([chat("a", { attention: attention(30, "error") })], overlay, limits, NOW);
    expect(result.rows[0]).toMatchObject({ led: "error", sortAt: ago(30 * MIN) });
  });

  it("an unread chat older than the expiry falls back to its status bucket", () => {
    const stale = chat("stale", { attention: attention(8 * 24 * 60) });
    const staleRunning = chat("stale-run", {
      status: "running",
      startedAt: ago(5 * MIN),
      attention: attention(8 * 24 * 60),
    });
    const result = buildTriage([stale, staleRunning], {}, limits, NOW);
    expect(result.counts.unread).toBe(0);
    expect(result.rows.find((row) => row.agentId === "stale-run")?.bucket).toBe("running");
  });

  it("Later on a chat whose attention expired makes it unread again, and the old flag does not hide it", () => {
    const stale = chat("stale", { attention: attention(9 * 24 * 60) });
    expect(buildTriage([stale], {}, limits, NOW).rows[0]?.bucket).toBe("inactive");
    const later = markUnread({}, "h1:stale", ago(2 * MIN));
    const row = buildTriage([stale], later, limits, NOW).rows[0];
    expect(row).toMatchObject({ bucket: "unread", sortAt: ago(2 * MIN) });
  });

  it("a Later mark expires like any other unread", () => {
    const later = markUnread({}, "h1:a", ago(8 * DAY));
    expect(buildTriage([chat("a")], later, limits, NOW).rows[0]?.bucket).toBe("inactive");
  });

  it("markRead covers every key given and keeps unrelated entries", () => {
    const next = markRead({ "h1:keep": { unreadAt: 1 } }, ["h1:a", "h2:b"], 99);
    expect(next).toEqual({ "h1:keep": { unreadAt: 1 }, "h1:a": { dismissedAt: 99 }, "h2:b": { dismissedAt: 99 } });
  });

  it("pruneOverlay drops vanished chats and month-old entries, and waits for a loaded list", () => {
    const overlay: Overlay = {
      "h1:live": { dismissedAt: ago(1 * DAY) },
      "h1:gone": { dismissedAt: ago(1 * DAY) },
      "h1:ancient": { dismissedAt: ago(40 * DAY) },
    };
    expect(pruneOverlay(overlay, new Set(["h1:live", "h1:ancient"]), NOW)).toEqual({
      "h1:live": { dismissedAt: ago(1 * DAY) },
    });
    expect(pruneOverlay(overlay, null, NOW)).toBe(overlay);
  });
});

describe("nextUp", () => {
  it("returns the top unread that is not the current chat", () => {
    const result = buildTriage(
      [chat("a", { attention: attention(30) }), chat("b", { attention: attention(10) }), chat("c")],
      {},
      limits,
      NOW,
    );
    expect(nextUp(result, "h1:a")?.agentId).toBe("b");
    expect(nextUp(result, null)?.agentId).toBe("a");
  });

  it("falls back to running, then nothing when only inactive chats remain", () => {
    const withRunning = buildTriage([chat("r", { status: "running", startedAt: ago(MIN) }), chat("i")], {}, limits, NOW);
    expect(nextUp(withRunning, null)?.agentId).toBe("r");
    expect(nextUp(buildTriage([chat("i")], {}, limits, NOW), null)).toBeNull();
  });
});

describe("row formatting", () => {
  it("cuts the workspace to 10 characters with an ellipsis", () => {
    expect(ellipsize("recent-chats-plugin", 10)).toBe("recent-ch\u2026");
    expect(ellipsize("paseo-core", 10)).toBe("paseo-core");
    expect(ellipsize("a\u{1F600}bcdefghijk", 4)).toBe("a\u{1F600}b\u2026");
  });

  it("falls back to provider and short id for untitled chats", () => {
    expect(chatTitle("  ", "claude", "abcdef123")).toBe("claude abcdef");
    expect(chatTitle(null, "codex", "xyz")).toBe("codex xyz");
    expect(chatTitle("Fix it", "claude", "abc")).toBe("Fix it");
  });

  it("cuts project and workspace names the same way and keeps host labels short", () => {
    expect(ellipsize("multi-host-manager", 10)).toBe("multi-hos\u2026");
    expect(ellipsize("laptop", 6)).toBe("laptop");
    expect(ellipsize("buildbox", 6)).toBe("build\u2026");
  });
});

describe("host colours", () => {
  const registry = JSON.stringify([
    { serverId: "a", label: "A", appearance: { color: "violet", badgeDisplay: null } },
    { serverId: "b", label: "B", appearance: { color: "none", badgeDisplay: null } },
    { serverId: "c", label: "C", appearance: { color: "chartreuse" } },
    { serverId: "d", label: "D" },
  ]);

  it("reads only configured, known colours from the saved host list", () => {
    expect(parseHostColorNames(registry)).toEqual({ a: "violet" });
  });

  it("returns no colours for a missing or unreadable list", () => {
    expect(parseHostColorNames(null)).toEqual({});
    expect(parseHostColorNames("not json")).toEqual({});
    expect(parseHostColorNames('{"a":1}')).toEqual({});
  });

  it("uses Paseo's light and dark foreground per theme, and nothing for none", () => {
    expect(hostColors("violet", true)?.text).toBe("#a392d5");
    expect(hostColors("violet", false)?.text).toBe("#6d49b5");
    expect(hostColors("none", true)).toBeNull();
    expect(hostColors(undefined, true)).toBeNull();
  });
});

describe("sub-agents", () => {
  it("recognises the parent label Paseo puts on delegated agents", () => {
    expect(isDelegated({ "paseo.parent-agent-id": "abc" })).toBe(true);
    expect(isDelegated({ "paseo.parent-agent-id": "  " })).toBe(false);
    expect(isDelegated({})).toBe(false);
    expect(isDelegated(undefined)).toBe(false);
  });
});

describe("pinned chats", () => {
  const pin = (key: string, minutes: number): Overlay => ({ [key]: { pinnedAt: ago(minutes * MIN) } });

  it("lists a pinned chat first whatever its state, and keeps its state for the light", () => {
    const result = buildTriage(
      [chat("idle-pinned", { lastUserMessageAt: ago(60 * 24 * 5) }), chat("u", { attention: attention(5) }), chat("r", { status: "running", startedAt: ago(2) })],
      pin("h1:idle-pinned", 10),
      limits,
      NOW,
    );
    expect(ids(result.rows)).toEqual(["idle-pinned", "u", "r"]);
    expect(result.rows[0]).toMatchObject({ pinned: true, bucket: "inactive", led: "idle" });
    expect(result.pinned).toBe(1);
  });

  it("a pinned unread chat is pinned and still unread", () => {
    const result = buildTriage([chat("a", { attention: { reason: "permission", at: ago(3) } })], pin("h1:a", 1), limits, NOW);
    expect(result.rows[0]).toMatchObject({ pinned: true, bucket: "unread", led: "permission" });
    expect(result.counts.unread).toBe(1);
    expect(result.worstUnread).toBe("permission");
  });

  it("orders pinned chats by when they were pinned, oldest pin first", () => {
    const overlay: Overlay = { ...pin("h1:b", 5), ...pin("h1:a", 50), ...pin("h1:c", 20) };
    const result = buildTriage([chat("a"), chat("b"), chat("c")], overlay, limits, NOW);
    expect(ids(result.rows)).toEqual(["a", "c", "b"]);
  });

  it("does not count against the caps and ignores the inactive window", () => {
    const old = chat("old", { lastUserMessageAt: ago(40 * DAY) });
    const unreadChats = [1, 2, 3, 4].map((n) => chat(`u${n}`, { attention: attention(100 - n) }));
    const result = buildTriage([old, ...unreadChats], { ...pin("h1:old", 2), ...pin("h1:u1", 1) }, limits, NOW);
    expect(ids(result.rows)).toEqual(["old", "u1", "u2", "u3", "u4"]);
    expect(result.hidden.unread).toBe(0);
    expect(result.rows.filter((row) => row.bucket === "unread" && !row.pinned)).toHaveLength(3);
  });

  it("keeps pinned chats of each host together on top when grouped", () => {
    const result = buildTriage(
      [chat("a1", { hostId: "A" }), chat("a2", { hostId: "A", attention: attention(5) }), chat("b1", { hostId: "B" })],
      { "B:b1": { pinnedAt: ago(1) } },
      limits,
      NOW,
      { groupByHost: true, hostOrder: ["A", "B"] },
    );
    expect(ids(result.rows)).toEqual(["a2", "a1", "b1"]);
    expect(result.pinned).toBe(1);
  });

  it("pin and unpin are inverse, keep other marks, and drop an empty entry", () => {
    const pinned = pinChat({ "h:a": { dismissedAt: 5 } }, "h:a", 9);
    expect(pinned["h:a"]).toEqual({ dismissedAt: 5, pinnedAt: 9 });
    expect(pinChat(pinned, "h:a", 99)).toBe(pinned);
    expect(unpinChat(pinned, "h:a")["h:a"]).toEqual({ dismissedAt: 5 });
    expect(unpinChat(pinChat({}, "h:b", 1), "h:b")).toEqual({});
    const same = { "h:c": { dismissedAt: 1 } };
    expect(unpinChat(same, "h:c")).toBe(same);
  });

  it("marking read or unread leaves the pin alone", () => {
    expect(markRead(pinChat({}, "h:a", 1), ["h:a"], 5)["h:a"]).toEqual({ pinnedAt: 1, dismissedAt: 5 });
    expect(markUnread(pinChat({}, "h:a", 1), "h:a", 5)["h:a"]).toEqual({ pinnedAt: 1, unreadAt: 5 });
  });

  it("a pin survives pruning by age but not by a vanished chat", () => {
    const overlay: Overlay = {
      "h1:pin": { pinnedAt: ago(90 * DAY), dismissedAt: ago(90 * DAY) },
      "h1:gone": { pinnedAt: ago(MIN) },
      "h1:old": { dismissedAt: ago(90 * DAY) },
    };
    expect(pruneOverlay(overlay, new Set(["h1:pin", "h1:old"]), NOW)).toEqual({ "h1:pin": overlay["h1:pin"] });
  });
});
