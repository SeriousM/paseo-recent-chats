import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginHostSummary } from "@getpaseo/plugin/client";

// The store talks to the Paseo app (host connections), to each host's settings RPC through the peer
// directory, and to browser storage. Connections, RPCs and storage are controllable fakes; the store's
// own logic and the peer directory run for real. Two stores sharing one directory stand for the plugin
// copies of two hosts loaded in the same app.
const fake = vi.hoisted(() => ({
  /** serverId -> what that host's observer publishes. */
  hostData: new Map<string, unknown>(),
  observerStarts: [] as string[],
  clientErrors: new Map<string, string>(),
  /** The app hands out the same connection object for a host until it reconnects. */
  clients: new Map<string, { hostId: string }>(),
  /** The copy earlier versions kept on web and desktop. */
  device: { raw: null as string | null, cleared: 0 },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  getPaseoClient: (hostId: string) => {
    const error = fake.clientErrors.get(hostId);
    if (error) throw new Error(error);
    let client = fake.clients.get(hostId);
    if (!client) {
      client = { hostId };
      fake.clients.set(hostId, client);
    }
    return client;
  },
}));

vi.mock("../client/host-observer", () => ({
  createHostObserver: (api: { hostId: string }, publish: (data: unknown) => void) => ({
    start() {
      fake.observerStarts.push(api.hostId);
      publish(fake.hostData.get(api.hostId));
    },
    stop() {},
  }),
}));

vi.mock("../client/web", () => ({
  readDevicePrefs: () => fake.device.raw,
  clearDevicePrefs: () => {
    fake.device.raw = null;
    fake.device.cleared += 1;
  },
  readHostColorNames: () => ({}),
}));

import { createPeerDirectory, type PeerDirectory } from "../client/peers";
import { createStore, type Rpc } from "../client/store";
import { overlaySettings, prefsSettings } from "../shared/settings";

const DEFAULTS = prefsSettings.schema.parse({});
const NOW = Date.UTC(2026, 10, 5, 12, 0, 0);

interface HostSettings {
  revision: number;
  values: unknown;
  /** Fail reads/writes while set. */
  down: boolean;
  /** Writes made, in order. */
  writes: unknown[];
  /** Resolve this to let a write finish (used to hold one back). */
  gate: Promise<void> | null;
}

/** A fake of one host's settings RPC with revisions, like the real one. */
function fakeRpc() {
  const docs: Record<"overlay" | "prefs", HostSettings> = {
    overlay: { revision: 1, values: { entries: {} }, down: false, writes: [], gate: null },
    prefs: { revision: 1, values: DEFAULTS, down: false, writes: [], gate: null },
  };
  const reads = { overlay: 0, prefs: 0 };
  const rpc = (async (contract: { name: string }, input: { revision?: string; values?: unknown }) => {
    const [, id, op] = contract.name.split(".") as [string, "overlay" | "prefs", string];
    const doc = docs[id];
    if (op === "read") {
      reads[id] += 1;
      if (doc.down) throw new Error("host unreachable");
      return { status: "ready", revision: String(doc.revision), values: doc.values };
    }
    if (doc.gate) await doc.gate;
    if (doc.down) throw new Error("host unreachable");
    if (input.revision !== String(doc.revision)) return { status: "conflict", error: "revision changed" };
    doc.revision += 1;
    doc.values = input.values;
    doc.writes.push(input.values);
    return { status: "saved", revision: String(doc.revision), values: doc.values };
  }) as unknown as Rpc;
  const entries = () => overlaySettings.schema.parse(docs.overlay.values).entries;
  return { rpc, docs, reads, entries };
}

let directory: PeerDirectory;

/** The plugin copy of host `selfId`, keeping its settings in `settings`. */
function storeOn(selfId: string, settings = fakeRpc()) {
  const store = createStore({ rpc: settings.rpc, resolveSelf: async () => selfId, directory });
  return { store, ...settings };
}

const host = (serverId: string, status: PluginHostSummary["status"] = "online"): PluginHostSummary => ({
  serverId,
  label: serverId.toUpperCase(),
  status,
});

function agent(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    provider: "omp",
    cwd: "C:\\work\\my-project",
    workspaceId: "w1",
    model: "vendor/claude/opus-5.5",
    title: `chat ${id}`,
    labels: {},
    status: "idle",
    updatedAt: new Date(NOW - 60_000).toISOString(),
    lastUserMessageAt: null,
    ...patch,
  };
}

const data = (agents: unknown[], workspaces: unknown[] = []) => ({ agents, workspaces, loading: false, error: null });

const settle = () => vi.advanceTimersByTimeAsync(300);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fake.hostData.clear();
  fake.observerStarts.length = 0;
  fake.clientErrors.clear();
  fake.clients.clear();
  fake.device.raw = null;
  fake.device.cleared = 0;
  directory = createPeerDirectory({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("chats in the snapshot", () => {
  it("fills names, branch and agent from the workspace, and falls back to the folder name", async () => {
    fake.hostData.set(
      "a",
      data(
        [agent("with-ws"), agent("no-ws", { workspaceId: "missing" })],
        [{ id: "w1", name: "Checkout", projectDisplayName: "Storefront", gitRuntime: { currentBranch: "feature/x" } }],
      ),
    );
    const { store } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    const chats = store.getSnapshot().chats;
    expect(chats.find((chat) => chat.agentId === "with-ws")).toMatchObject({
      projectName: "Storefront",
      workspaceName: "Checkout",
      branch: "feature/x",
      agentName: "opus-5.5",
    });
    expect(chats.find((chat) => chat.agentId === "no-ws")).toMatchObject({ projectName: "", workspaceName: "my-project", branch: "" });
    store.dispose();
  });

  it("leaves out sub-agents, and uses updatedAt when attention has no timestamp", async () => {
    fake.hostData.set(
      "a",
      data([
        agent("main", { requiresAttention: true, attentionReason: "finished", attentionTimestamp: null }),
        agent("sub", { labels: { "paseo.parent-agent-id": "main" } }),
      ]),
    );
    const { store } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    const chats = store.getSnapshot().chats;
    expect(chats.map((chat) => chat.agentId)).toEqual(["main"]);
    expect(chats[0]?.attention).toEqual({ reason: "finished", at: NOW - 60_000 });
    store.dispose();
  });

  it("hides the chats of a host that is switched off, but keeps it in the filter", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    fake.hostData.set("b", data([agent("b1")]));
    const { store, docs } = storeOn("a");
    store.setHosts([host("a"), host("b")]);
    store.retain();
    await settle();
    store.toggleHost("b");
    const snapshot = store.getSnapshot();
    expect(snapshot.chats.map((chat) => chat.agentId)).toEqual(["a1"]);
    expect(snapshot.hosts).toEqual([
      { id: "a", label: "A", hidden: false },
      { id: "b", label: "B", hidden: true },
    ]);
    expect(snapshot.hostCount).toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(docs.prefs.writes.at(-1)).toMatchObject({ hiddenHosts: ["b"] });
    store.dispose();
  });

  it("lists only online hosts", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const { store } = storeOn("a");
    store.setHosts([host("a"), host("off", "offline")]);
    store.retain();
    await settle();
    expect(store.getSnapshot().hosts.map((entry) => entry.id)).toEqual(["a"]);
    store.dispose();
  });
});

describe("observing hosts", () => {
  it("does not start a second set of timers when re-retained inside the grace period", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const { store, reads } = storeOn("a");
    store.setHosts([host("a")]);
    const release = store.retain();
    await settle();
    release();
    store.retain();
    const before = reads.overlay;
    await vi.advanceTimersByTimeAsync(60_000);
    // One periodic overlay read per minute, not two.
    expect(reads.overlay - before).toBe(1);
    expect(fake.observerStarts).toEqual(["a"]);
    store.dispose();
  });

  it("stops observing after the grace period and starts again when needed", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const { store } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain()();
    await vi.advanceTimersByTimeAsync(6_000);
    store.retain();
    await settle();
    expect(fake.observerStarts).toEqual(["a", "a"]);
    store.dispose();
  });

  it("starts a host's subscription again after it failed", async () => {
    fake.hostData.set("a", { agents: [], workspaces: [], loading: false, error: "agents: not ready" });
    const { store } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    expect(fake.observerStarts).toEqual(["a"]);
    expect(store.getSnapshot().errors).toEqual(["A: agents: not ready"]);
    fake.hostData.set("a", data([agent("a1")]));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fake.observerStarts).toEqual(["a", "a"]);
    expect(store.getSnapshot().errors).toEqual([]);
    expect(store.getSnapshot().chats).toHaveLength(1);
    store.dispose();
  });

  it("drops the error of a host that went offline", async () => {
    fake.hostData.set("a", data([]));
    fake.clientErrors.set("a", "no connection");
    const { store } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    expect(store.getSnapshot().errors).toEqual(["A: no connection"]);
    store.setHosts([host("a", "offline")]);
    expect(store.getSnapshot().errors).toEqual([]);
    store.dispose();
  });
});

describe("read marks and pins", () => {
  it("saves a mark, and shows it at once", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const { store, docs } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    const pinnedAt = Date.now();
    store.setPinned("a:a1", true);
    expect(store.getSnapshot().overlay["a:a1"]?.pinnedAt).toBe(pinnedAt);
    await settle();
    expect(docs.overlay.writes).toHaveLength(1);
    store.dispose();
  });

  it("writes again on a revision conflict and keeps what another client saved", async () => {
    fake.hostData.set("a", data([agent("a1"), agent("a2")]));
    const { store, docs, entries } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    // Another client saves in between: the store's revision is now stale.
    docs.overlay.revision += 1;
    docs.overlay.values = { entries: { "a:a2": { pinnedAt: 5 } } };
    const markedAt = Date.now();
    store.markRead(["a:a1"]);
    await settle();
    expect(entries()["a:a1"]?.dismissedAt).toBe(markedAt);
    expect(entries()["a:a2"]?.pinnedAt).toBe(5);
    expect(store.getSnapshot().errors).toEqual([]);
    store.dispose();
  });

  it("does not let the periodic read undo a change whose write is still pending", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const { store, docs, reads } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    const { promise, resolve: release } = Promise.withResolvers<void>();
    docs.overlay.gate = promise;
    const pinnedAt = Date.now();
    store.setPinned("a:a1", true);
    const readsBefore = reads.overlay;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reads.overlay).toBe(readsBefore);
    expect(store.getSnapshot().overlay["a:a1"]?.pinnedAt).toBe(pinnedAt);
    release();
    await settle();
    expect(store.getSnapshot().overlay["a:a1"]?.pinnedAt).toBeDefined();
    store.dispose();
  });

  it("keeps a change made while an earlier write fails, and reports the failure", async () => {
    fake.hostData.set("a", data([agent("a1"), agent("a2")]));
    const { store, docs } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    docs.overlay.down = true;
    store.setPinned("a:a1", true);
    store.setPinned("a:a2", true);
    await settle();
    expect(store.getSnapshot().errors.some((error) => error.startsWith("Read state:"))).toBe(true);
    docs.overlay.down = false;
    store.markRead(["a:a1"]);
    await settle();
    expect(store.getSnapshot().errors).toEqual([]);
    store.dispose();
  });
});

describe("read marks across hosts", () => {
  beforeEach(() => {
    fake.hostData.set("a", data([agent("a1")]));
    fake.hostData.set("b", data([agent("b1")]));
  });

  it("keeps a chat's pin on that chat's host, and every copy shows it", async () => {
    const a = storeOn("a");
    const b = storeOn("b");
    for (const { store } of [a, b]) {
      store.setHosts([host("a"), host("b")]);
      store.retain();
    }
    await settle();
    const pinnedAt = Date.now();
    a.store.setPinned("b:b1", true);
    await settle();
    expect(b.entries()["b:b1"]?.pinnedAt).toBe(pinnedAt);
    expect(a.entries()["b:b1"]).toBeUndefined();
    expect(b.store.getSnapshot().overlay["b:b1"]?.pinnedAt).toBe(pinnedAt);
    expect(a.store.getSnapshot().storageHosts).toEqual(["A", "B"]);
    a.store.dispose();
    b.store.dispose();
  });

  it("keeps marks on this host while the chat's host has no plugin copy, and moves them there once it has", async () => {
    const a = storeOn("a");
    a.store.setHosts([host("a"), host("b")]);
    a.store.retain();
    await settle();
    const pinnedAt = Date.now();
    a.store.setPinned("b:b1", true);
    await settle();
    expect(a.entries()["b:b1"]?.pinnedAt).toBe(pinnedAt);
    const b = storeOn("b");
    await settle();
    expect(b.entries()["b:b1"]?.pinnedAt).toBe(pinnedAt);
    expect(a.entries()["b:b1"]).toBeUndefined();
    a.store.dispose();
    b.store.dispose();
  });

  it("merges copies of one chat kept on two hosts: latest read, earliest pin", async () => {
    const a = fakeRpc();
    a.docs.overlay.values = { entries: { "b:b1": { pinnedAt: 50, dismissedAt: 10 } } };
    const b = fakeRpc();
    b.docs.overlay.values = { entries: { "b:b1": { pinnedAt: 70, dismissedAt: 90 } } };
    const first = storeOn("a", a);
    const second = storeOn("b", b);
    first.store.setHosts([host("a"), host("b")]);
    first.store.retain();
    await settle();
    expect(b.entries()["b:b1"]).toEqual({ pinnedAt: 50, dismissedAt: 90 });
    expect(a.entries()["b:b1"]).toBeUndefined();
    first.store.dispose();
    second.store.dispose();
  });
});

describe("view settings across hosts", () => {
  it("writes a change to every host after a short delay, one write each", async () => {
    const a = storeOn("a");
    const b = storeOn("b");
    a.store.setHosts([host("a"), host("b")]);
    a.store.retain();
    await settle();
    const writesBefore = [a.docs.prefs.writes.length, b.docs.prefs.writes.length];
    const changedAt = Date.now();
    a.store.updatePrefs({ maxUnread: 8 });
    a.store.updatePrefs({ maxInactive: 9 });
    await vi.advanceTimersByTimeAsync(600);
    expect(a.docs.prefs.writes.length - (writesBefore[0] ?? 0)).toBe(1);
    expect(b.docs.prefs.writes.length - (writesBefore[1] ?? 0)).toBe(1);
    expect(b.docs.prefs.writes.at(-1)).toMatchObject({ maxUnread: 8, maxInactive: 9, updatedAt: changedAt });
    a.store.dispose();
    b.store.dispose();
  });

  it("takes the most recently changed copy and brings the older one up to date", async () => {
    const a = fakeRpc();
    a.docs.prefs.values = { ...DEFAULTS, maxUnread: 9, updatedAt: 100 };
    const b = fakeRpc();
    b.docs.prefs.values = { ...DEFAULTS, maxUnread: 12, updatedAt: 200 };
    const first = storeOn("a", a);
    const second = storeOn("b", b);
    first.store.setHosts([host("a"), host("b")]);
    first.store.retain();
    await settle();
    expect(first.store.getSnapshot().prefs.maxUnread).toBe(12);
    expect(a.docs.prefs.values).toMatchObject({ maxUnread: 12, updatedAt: 200 });
    expect(b.docs.prefs.writes).toEqual([]);
    first.store.dispose();
    second.store.dispose();
  });

  it("settles on this host's copy when no copy was changed yet, and stamps it so it reaches every host", async () => {
    const a = fakeRpc();
    a.docs.prefs.values = { ...DEFAULTS, maxUnread: 9 };
    const b = fakeRpc();
    b.docs.prefs.values = { ...DEFAULTS, maxUnread: 12 };
    const first = storeOn("a", a);
    const second = storeOn("b", b);
    first.store.setHosts([host("a"), host("b")]);
    first.store.retain();
    await settle();
    expect(first.store.getSnapshot().prefs.maxUnread).toBe(9);
    expect(b.docs.prefs.values).toMatchObject({ maxUnread: 9, updatedAt: 1 });
    first.store.dispose();
    second.store.dispose();
  });

  it("moves the copy earlier versions kept on this device to the hosts, ahead of settled copies", async () => {
    fake.device.raw = JSON.stringify({ ...DEFAULTS, maxRunning: 6 });
    const a = fakeRpc();
    a.docs.prefs.values = { ...DEFAULTS, maxRunning: 2, updatedAt: 1 };
    const { store } = storeOn("a", a);
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    expect(store.getSnapshot().prefs.maxRunning).toBe(6);
    expect(a.docs.prefs.values).toMatchObject({ maxRunning: 6, updatedAt: NOW });
    expect(fake.device.raw).toBeNull();
    store.dispose();
  });

  it("drops the device copy when a host holds a change made since", async () => {
    fake.device.raw = JSON.stringify({ ...DEFAULTS, maxRunning: 6 });
    const a = fakeRpc();
    a.docs.prefs.values = { ...DEFAULTS, maxRunning: 2, updatedAt: 500 };
    const { store } = storeOn("a", a);
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    expect(store.getSnapshot().prefs.maxRunning).toBe(2);
    expect(fake.device.cleared).toBe(1);
    store.dispose();
  });

  it("hands a change to the other plugin copies at once", async () => {
    const a = storeOn("a");
    const b = storeOn("b");
    for (const { store } of [a, b]) {
      store.setHosts([host("a"), host("b")]);
      store.retain();
    }
    await settle();
    a.store.updatePrefs({ maxUnread: 15 });
    await vi.advanceTimersByTimeAsync(600);
    expect(b.store.getSnapshot().prefs.maxUnread).toBe(15);
    a.store.dispose();
    b.store.dispose();
  });

  it("does not store defaults when no host can be read, and adopts the hosts' settings later", async () => {
    const a = fakeRpc();
    a.docs.prefs.values = { ...DEFAULTS, maxUnread: 9, updatedAt: 100 };
    a.docs.prefs.down = true;
    const { store } = storeOn("a", a);
    store.setHosts([host("a")]);
    fake.hostData.set("a", data([]));
    store.retain();
    await settle();
    expect(a.docs.prefs.writes).toEqual([]);
    expect(store.getSnapshot().prefs.maxUnread).toBe(DEFAULTS.maxUnread);
    a.docs.prefs.down = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.getSnapshot().prefs.maxUnread).toBe(9);
    store.dispose();
  });

  it("builds an edit made before any host could be read on the hosts' copy", async () => {
    const a = fakeRpc();
    a.docs.prefs.values = { ...DEFAULTS, maxRunning: 7, updatedAt: 100 };
    a.docs.prefs.down = true;
    const { store } = storeOn("a", a);
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    store.updatePrefs({ maxUnread: 11 });
    a.docs.prefs.down = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.docs.prefs.writes.at(-1)).toMatchObject({ maxUnread: 11, maxRunning: 7 });
    store.dispose();
  });

  it("writes again after a conflict with another client's save", async () => {
    const { store, docs } = storeOn("a");
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    docs.prefs.revision += 1;
    store.updatePrefs({ maxUnread: 8 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(docs.prefs.writes.at(-1)).toMatchObject({ maxUnread: 8 });
    expect(store.getSnapshot().errors).toEqual([]);
    store.dispose();
  });

  it("leaves a stored copy that cannot be read alone until the user changes something", async () => {
    const a = fakeRpc();
    a.docs.prefs.values = { maxUnread: 0 };
    const { store } = storeOn("a", a);
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    expect(a.docs.prefs.writes).toEqual([]);
    store.updatePrefs({ maxUnread: 12 });
    await vi.advanceTimersByTimeAsync(600);
    expect(a.docs.prefs.writes.at(-1)).toMatchObject({ maxUnread: 12 });
    store.dispose();
  });
});
