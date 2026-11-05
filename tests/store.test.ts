import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginHostSummary } from "@getpaseo/plugin/client";

// The store talks to the Paseo app (host connections), to the host's settings RPC and to browser storage.
// All three are replaced by controllable fakes; the store's own logic runs for real.
const fake = vi.hoisted(() => ({
  /** serverId -> what that host's observer publishes. */
  hostData: new Map<string, unknown>(),
  observerStarts: [] as string[],
  clientErrors: new Map<string, string>(),
  /** The app hands out the same connection object for a host until it reconnects. */
  clients: new Map<string, { hostId: string }>(),
  storage: { available: true, raw: null as string | null, writes: [] as string[] },
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
  deviceStorageAvailable: () => fake.storage.available,
  readDevicePrefs: () => fake.storage.raw,
  writeDevicePrefs: (json: string) => {
    fake.storage.raw = json;
    fake.storage.writes.push(json);
    return true;
  },
  readHostColorNames: () => ({}),
}));

import { createStore, type Rpc } from "../client/store";
import { prefsSettings } from "../shared/settings";

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

/** A fake of the host's settings RPC with revisions, like the real one. */
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
  return { rpc, docs, reads };
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
  fake.storage.available = true;
  fake.storage.raw = null;
  fake.storage.writes.length = 0;
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
    const { rpc } = fakeRpc();
    const store = createStore(rpc);
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
    const store = createStore(fakeRpc().rpc);
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
    const store = createStore(fakeRpc().rpc);
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
    expect(JSON.parse(fake.storage.raw ?? "{}").hiddenHosts).toEqual(["b"]);
    store.dispose();
  });

  it("lists only online hosts", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const store = createStore(fakeRpc().rpc);
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
    const { rpc, reads } = fakeRpc();
    const store = createStore(rpc);
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
    const store = createStore(fakeRpc().rpc);
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
    const store = createStore(fakeRpc().rpc);
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
    const store = createStore(fakeRpc().rpc);
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
    const { rpc, docs } = fakeRpc();
    const store = createStore(rpc);
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
    const { rpc, docs } = fakeRpc();
    const store = createStore(rpc);
    store.setHosts([host("a")]);
    store.retain();
    await settle();
    // Another client saves in between: the store's revision is now stale.
    docs.overlay.revision += 1;
    docs.overlay.values = { entries: { "a:a2": { pinnedAt: 5 } } };
    const markedAt = Date.now();
    store.markRead(["a:a1"]);
    await settle();
    const saved = docs.overlay.values as { entries: Record<string, { dismissedAt?: number; pinnedAt?: number }> };
    expect(saved.entries["a:a1"]?.dismissedAt).toBe(markedAt);
    expect(saved.entries["a:a2"]?.pinnedAt).toBe(5);
    expect(store.getSnapshot().errors).toEqual([]);
    store.dispose();
  });

  it("does not let the periodic read undo a change whose write is still pending", async () => {
    fake.hostData.set("a", data([agent("a1")]));
    const { rpc, docs, reads } = fakeRpc();
    const store = createStore(rpc);
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
    const { rpc, docs } = fakeRpc();
    const store = createStore(rpc);
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

describe("settings storage on the device", () => {
  it("adopts the host's settings on first run and stores them", async () => {
    const { rpc, docs } = fakeRpc();
    docs.prefs.values = { ...DEFAULTS, maxUnread: 9 };
    const store = createStore(rpc);
    store.retain();
    await settle();
    expect(store.getSnapshot().prefs.maxUnread).toBe(9);
    expect(JSON.parse(fake.storage.raw ?? "{}").maxUnread).toBe(9);
    expect(store.getSnapshot().prefsStorage).toBe("device");
    store.dispose();
  });

  it("does not store defaults when the host cannot be read, and adopts its settings later", async () => {
    const { rpc, docs } = fakeRpc();
    docs.prefs.values = { ...DEFAULTS, maxUnread: 9 };
    docs.prefs.down = true;
    const store = createStore(rpc);
    store.setHosts([host("a")]);
    fake.hostData.set("a", data([]));
    store.retain();
    await settle();
    expect(fake.storage.writes).toEqual([]);
    expect(store.getSnapshot().prefs.maxUnread).toBe(DEFAULTS.maxUnread);
    docs.prefs.down = false;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(store.getSnapshot().prefs.maxUnread).toBe(9);
    expect(JSON.parse(fake.storage.raw ?? "{}").maxUnread).toBe(9);
    store.dispose();
  });

  it("leaves a stored copy that cannot be read alone until the user changes something", async () => {
    fake.storage.raw = "{ broken";
    const store = createStore(fakeRpc().rpc);
    store.retain();
    await settle();
    expect(fake.storage.writes).toEqual([]);
    expect(store.getSnapshot().prefs.maxUnread).toBe(DEFAULTS.maxUnread);
    store.updatePrefs({ maxUnread: 12 });
    expect(JSON.parse(fake.storage.raw ?? "{}").maxUnread).toBe(12);
    store.dispose();
  });

  it("uses the stored copy and never writes it back unchanged", async () => {
    fake.storage.raw = JSON.stringify({ ...DEFAULTS, maxInactive: 7 });
    const store = createStore(fakeRpc().rpc);
    store.retain();
    await settle();
    expect(store.getSnapshot().prefs.maxInactive).toBe(7);
    expect(fake.storage.writes).toEqual([]);
    store.dispose();
  });

  it("keeps an edit made while the first read is under way", async () => {
    const { rpc, docs } = fakeRpc();
    docs.prefs.values = { ...DEFAULTS, maxRunning: 7 };
    const store = createStore(rpc);
    store.retain();
    store.updatePrefs({ maxUnread: 11 });
    await settle();
    const prefs = store.getSnapshot().prefs;
    expect(prefs).toMatchObject({ maxUnread: 11, maxRunning: 7 });
    expect(JSON.parse(fake.storage.raw ?? "{}")).toMatchObject({ maxUnread: 11, maxRunning: 7 });
    store.dispose();
  });
});

describe("settings storage on the host (phones)", () => {
  beforeEach(() => {
    fake.storage.available = false;
  });

  it("saves changes to the host after a short delay, as one write", async () => {
    const { rpc, docs } = fakeRpc();
    const store = createStore(rpc);
    store.retain();
    await settle();
    store.updatePrefs({ maxUnread: 8 });
    store.updatePrefs({ maxInactive: 9 });
    expect(docs.prefs.writes).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(600);
    expect(docs.prefs.writes).toHaveLength(1);
    expect(docs.prefs.writes[0]).toMatchObject({ maxUnread: 8, maxInactive: 9 });
    expect(store.getSnapshot().prefsStorage).toBe("host");
    store.dispose();
  });

  it("builds an edit made before the host could be read on the host's copy instead of the defaults", async () => {
    const { rpc, docs } = fakeRpc();
    docs.prefs.values = { ...DEFAULTS, maxRunning: 7 };
    docs.prefs.down = true;
    const store = createStore(rpc);
    store.retain();
    await settle();
    store.updatePrefs({ maxUnread: 11 });
    docs.prefs.down = false;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(docs.prefs.writes.at(-1)).toMatchObject({ maxUnread: 11, maxRunning: 7 });
    store.dispose();
  });

  it("writes again after a conflict with another client's save", async () => {
    const { rpc, docs } = fakeRpc();
    const store = createStore(rpc);
    store.retain();
    await settle();
    docs.prefs.revision += 1;
    store.updatePrefs({ maxUnread: 8 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(docs.prefs.writes.at(-1)).toMatchObject({ maxUnread: 8 });
    expect(store.getSnapshot().errors).toEqual([]);
    store.dispose();
  });
});
