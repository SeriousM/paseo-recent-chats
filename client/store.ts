// One store per plugin copy, shared by that copy's surfaces (sidebar, pill popups, screens). Closure based:
// no classes (Hermes). Observes every online host, and keeps the read marks and view settings in the
// settings documents of every host that runs this plugin, reached through the peer directory.
import { getPaseoClient, type PluginCommandCapabilities, type PluginHostSummary } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { createHostObserver, type HostData, type HostObserver } from "./host-observer";
import { markRead, markUnread, mergeOverlays, pinChat, pruneOverlay, unpinChat } from "./overlay";
import type { PaseoAgent, PaseoApi } from "./paseo-types";
import { createPeerDirectory, type Peer, type PeerDirectory } from "./peers";
import { chatKey, isDelegated, keyHost, type ChatInput, type Overlay, type OverlayEntry } from "./triage";
import { clearDevicePrefs, readDevicePrefs, readHostColorNames } from "./web";
import { agentLabel } from "./format";
import { DEFAULT_PREFS, parseStoredPrefs, toggleHiddenHost, withNormalizedLayout } from "./prefs";
import { overlaySettings, prefsSettings, type Prefs } from "../shared/settings";
import type { Section } from "../shared/sections";
import { renameChat } from "../shared/rename";
import { checkForUpdate } from "../shared/updates";

export type Rpc = PluginCommandCapabilities["rpc"];

/** What one host's update check reported. */
export interface UpdateCheck {
  host: string;
  result: string;
  failed: boolean;
}

export interface HostChip {
  id: string;
  label: string;
  /** Switched off in the host filter. */
  hidden: boolean;
}

export interface StoreSnapshot {
  chats: readonly ChatInput[];
  overlay: Overlay;
  prefs: Prefs;
  /** Hosts whose chats are listed: online and not switched off in the host filter. */
  hostCount: number;
  /** Hosts for the filter: the online hosts, including the ones switched off so they can be switched back on. */
  hosts: readonly HostChip[];
  /** Labels of the hosts whose copy of the read marks and settings this device reaches right now. */
  storageHosts: readonly string[];
  /** serverId -> colour name chosen for the host in Paseo (web and desktop only). */
  hostColors: Readonly<Record<string, string>>;
  loading: boolean;
  errors: readonly string[];
}

export interface RecentsStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): StoreSnapshot;
  /** Count a mounted consumer; the store observes hosts while at least one is mounted. */
  retain(): () => void;
  setHosts(hosts: readonly PluginHostSummary[]): void;
  markRead(keys: readonly string[]): void;
  markUnread(key: string): void;
  /** Pin or unpin a chat. Pinned chats get their own section (first by default). */
  setPinned(key: string, pinned: boolean): void;
  /** Change view preferences. Applied at once, then saved to every host that runs this plugin. */
  updatePrefs(patch: Partial<Prefs>): void;
  /** Switch one host on or off in the host filter. */
  toggleHost(hostId: string): void;
  /** Switch a section between oldest first and newest first. */
  toggleSort(section: Section): void;
  /** Sets a chat's title, through the plugin copy of the chat's own host. Rejects with a readable reason. */
  renameChat(key: string, title: string): Promise<void>;
  /** Asks every reachable host's copy to check for a plugin update now. One entry per host. */
  checkForUpdates(): Promise<UpdateCheck[]>;
  /** Stops observation and drops every listener. Called when the plugin unloads. */
  dispose(): void;
}

const EMIT_DELAY_MS = 250;
const RECONCILE_MS = 15_000;
/** Another device's change shows up here within this time. Only while a surface is mounted. */
const OVERLAY_REFRESH_MS = 5_000;
const PREFS_REFRESH_MS = 30_000;
const STOP_GRACE_MS = 5_000;
const WRITE_ATTEMPTS = 4;

const PREFS_SAVE_DELAY_MS = 500;
/**
 * Stamp of settings that were settled on once but never changed since. A device copy from before the
 * settings moved to the hosts beats it, because that copy is a choice the user made; any real change wins.
 */
const SETTLED_STAMP = 1;

const overlayContracts = settingsRpc(overlaySettings.id);
const prefsContracts = settingsRpc(prefsSettings.id);

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A change to some chats' marks. `keys` names every chat `apply` may touch, so it can be routed to their hosts. */
interface OverlayOp {
  keys: readonly string[];
  apply(overlay: Overlay): Overlay;
}

export interface StoreOptions {
  /** This host's settings RPC. */
  rpc: Rpc;
  /** This host's serverId, under which the store registers in the peer directory. */
  resolveSelf(): Promise<string>;
  directory?: PeerDirectory;
}

const epoch = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isNaN(value) ? null : value;
};

function baseName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

interface WorkspaceNames {
  project: string;
  workspace: string;
  branch: string;
}

function toChat(
  host: PluginHostSummary,
  agent: PaseoAgent,
  workspaces: ReadonlyMap<string, WorkspaceNames>,
): ChatInput {
  const updatedAt = epoch(agent.updatedAt) ?? 0;
  const names = agent.workspaceId ? workspaces.get(agent.workspaceId) : undefined;
  return {
    hostId: host.serverId,
    hostLabel: host.label,
    agentId: agent.id,
    workspaceId: agent.workspaceId ?? null,
    projectName: names?.project ?? "",
    workspaceName: names?.workspace || baseName(agent.cwd),
    branch: names?.branch ?? "",
    agentName: agentLabel(agent.model, agent.provider),
    title: agent.title,
    provider: agent.provider,
    status: agent.status,
    startedAt: epoch(agent.activeTurn?.startedAt),
    lastUserMessageAt: epoch(agent.lastUserMessageAt),
    updatedAt,
    attention: agent.requiresAttention
      ? { reason: agent.attentionReason ?? null, at: epoch(agent.attentionTimestamp) ?? updatedAt }
      : null,
  };
}

export function createStore({ rpc, resolveSelf, directory = createPeerDirectory() }: StoreOptions): RecentsStore {
  const listeners = new Set<() => void>();
  const observers = new Map<string, { api: PaseoApi; observer: HostObserver }>();
  const hostData = new Map<string, HostData>();
  const hostErrors = new Map<string, string>();
  /** Passed with this store's change notices, so it does not re-read what it just wrote. */
  const origin = {};
  let hosts: readonly PluginHostSummary[] = [];
  let selfId: string | null = null;
  let selfError: string | null = null;
  let resolving = false;
  let unregister: (() => void) | null = null;
  let prefs: Prefs = DEFAULT_PREFS;
  let prefsEdited = false;
  /** A stored copy has been read (or the user has chosen settings), so defaults may not overwrite it. */
  let prefsLoaded = false;
  /** Edits made before any stored copy could be read; applied on top of it once one is. */
  let unsavedPatch: Partial<Prefs> = {};
  let prefsSyncing = false;
  let prefsAgain = false;
  let prefsError: string | null = null;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;
  let overlay: Overlay = {};
  /** serverId -> that host's copy of the read marks, as last read or written. */
  const docs = new Map<string, { revision: string; entries: Overlay }>();
  const docErrors = new Map<string, string>();
  let hostColors: Record<string, string> = {};
  let pendingOps: OverlayOp[] = [];
  /** The batch being written; still shown as applied until the write is done. */
  let inFlight: OverlayOp[] = [];
  let flushing = false;
  let reading = false;
  let readAgain = false;
  /** Counts saved writes, so a read that a write overtook does not bring back older copies. */
  let saves = 0;
  let started = false;
  let consumers = 0;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let overlayTimer: ReturnType<typeof setInterval> | undefined;
  let prefsRefreshTimer: ReturnType<typeof setInterval> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let emitTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: StoreSnapshot = buildSnapshot();
  const unsubscribe = directory.subscribe((change, from) => {
    if (!started || from === origin) return;
    if (change !== "prefs") void readOverlay();
    if (change !== "overlay") void syncPrefs();
  });
  void ensureSelf();

  function buildSnapshot(): StoreSnapshot {
    const chats: ChatInput[] = [];
    let loading = false;
    const errors: string[] = [];
    for (const host of hosts) {
      if (host.status !== "online" || prefs.hiddenHosts.includes(host.serverId)) continue;
      const data = hostData.get(host.serverId);
      if (!data) {
        loading = true;
        continue;
      }
      if (data.loading) loading = true;
      if (data.error) errors.push(`${host.label}: ${data.error}`);
      const names = new Map(
        data.workspaces.map((workspace) => [
          workspace.id,
          {
            project: workspace.projectDisplayName,
            workspace: workspace.name,
            branch: workspace.gitRuntime?.currentBranch ?? "",
          },
        ]),
      );
      for (const agent of data.agents) {
        if (!isDelegated(agent.labels)) chats.push(toChat(host, agent, names));
      }
    }
    const label = (hostId: string) => hosts.find((host) => host.serverId === hostId)?.label ?? hostId;
    for (const [hostId, error] of hostErrors) errors.push(`${label(hostId)}: ${error}`);
    if (selfError) errors.push(`Read state: this host is not known yet: ${selfError}`);
    for (const [hostId, error] of docErrors) errors.push(`Read state: ${label(hostId)}: ${error}`);
    if (prefsError) errors.push(`Settings: ${prefsError}`);
    return {
      chats,
      overlay,
      prefs,
      hostCount: hosts.filter((host) => host.status === "online" && !prefs.hiddenHosts.includes(host.serverId))
        .length,
      hosts: hosts
        .filter((host) => host.status === "online")
        .map((host) => ({
          id: host.serverId,
          label: host.label,
          hidden: prefs.hiddenHosts.includes(host.serverId),
        })),
      storageHosts: [...docs.keys()].map(label),
      hostColors,
      loading,
      errors,
    };
  }

  function emitNow() {
    if (emitTimer !== undefined) {
      clearTimeout(emitTimer);
      emitTimer = undefined;
    }
    snapshot = buildSnapshot();
    for (const listener of [...listeners]) listener();
  }

  function scheduleEmit() {
    if (!emitTimer) emitTimer = setTimeout(emitNow, EMIT_DELAY_MS);
  }

  function observeHost(hostId: string) {
    try {
      const api = getPaseoClient(hostId);
      const existing = observers.get(hostId);
      // A host whose subscription failed is started again on the next reconcile.
      if (existing?.api === api && !hostData.get(hostId)?.error) return;
      existing?.observer.stop();
      const observer = createHostObserver(api, (data) => {
        if (observers.get(hostId)?.observer !== observer) return;
        hostData.set(hostId, data);
        scheduleEmit();
      });
      observers.set(hostId, { api, observer });
      hostErrors.delete(hostId);
      observer.start();
    } catch (error) {
      hostErrors.set(hostId, error instanceof Error ? error.message : String(error));
    }
  }

  function reconcile() {
    hostColors = readHostColorNames();
    for (const [hostId, entry] of observers) {
      if (!hosts.some((host) => host.serverId === hostId && host.status === "online")) {
        entry.observer.stop();
        observers.delete(hostId);
        hostData.delete(hostId);
      }
    }
    for (const host of hosts) {
      if (host.status === "online") observeHost(host.serverId);
      else hostErrors.delete(host.serverId);
    }
    if (!selfId) void ensureSelf();
    else if (!prefsLoaded) void syncPrefs();
    emitNow();
  }

  /** Learns this host's serverId and offers this host's settings to the other plugin copies. */
  async function ensureSelf(): Promise<void> {
    if (selfId || resolving) return;
    resolving = true;
    try {
      const id = await resolveSelf();
      selfId = id;
      selfError = null;
      unregister = directory.register({ serverId: id, rpc });
      void flush();
      if (started) {
        void readOverlay();
        void syncPrefs();
      }
    } catch (error) {
      selfError = message(error);
    } finally {
      resolving = false;
    }
    emitNow();
  }

  /** This host and every online host whose plugin copy is loaded in this app. */
  function reachablePeers(): Peer[] {
    return directory
      .list()
      .filter((peer) => peer.serverId === selfId || hosts.some((host) => host.serverId === peer.serverId && host.status === "online"));
  }

  /** A chat's marks live on the chat's own host; on this host while that one cannot be reached. */
  function targetOf(key: string): string | null {
    const owner = keyHost(key);
    return reachablePeers().some((peer) => peer.serverId === owner) ? owner : selfId;
  }

  /** Keys of hosts whose chats are not loaded are kept; vanished chats on loaded hosts are pruned. */
  function liveKeys(candidate: Overlay): ReadonlySet<string> {
    const live = new Set<string>();
    const settled = new Set<string>();
    for (const [hostId, data] of hostData) {
      if (data.loading || data.error) continue;
      settled.add(hostId);
      for (const agent of data.agents) live.add(chatKey(hostId, agent.id));
    }
    for (const key of Object.keys(candidate)) {
      if (!settled.has(keyHost(key))) live.add(key);
    }
    return live;
  }

  const stored = (): Overlay => mergeOverlays([...docs.values()].map((doc) => doc.entries));
  const applyPending = (base: Overlay): Overlay =>
    [...inFlight, ...pendingOps].reduce((current, op) => op.apply(current), base);

  async function readDoc(peer: Peer): Promise<void> {
    const result = await fetchDoc(peer);
    if (typeof result === "string") docErrors.set(peer.serverId, result);
    else {
      docs.set(peer.serverId, result);
      docErrors.delete(peer.serverId);
    }
  }

  async function fetchDoc(peer: Peer): Promise<{ revision: string; entries: Overlay } | string> {
    try {
      const result = await peer.rpc(overlayContracts.read, {});
      if (result.status !== "ready") return result.error;
      return { revision: result.revision, entries: overlaySettings.schema.parse(result.values).entries };
    } catch (error) {
      return message(error);
    }
  }

  /** Reads every reachable host's copy. While a write is under way the periodic read waits. */
  async function readOverlay(): Promise<void> {
    if (!selfId) return;
    // One read at a time: an overlapping read with an older list of hosts would drop newer copies.
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    try {
      do {
        readAgain = false;
        await readOverlayOnce();
      } while (readAgain);
    } finally {
      reading = false;
    }
  }

  async function readOverlayOnce(): Promise<void> {
    if (flushing) return;
    const peers = reachablePeers();
    const before = saves;
    const results = await Promise.all(peers.map(fetchDoc));
    // A write finished meanwhile and left newer copies than these reads: read again.
    if (saves !== before) {
      readAgain = true;
      return;
    }
    if (flushing) return;
    peers.forEach((peer, index) => {
      const result = results[index];
      if (typeof result === "string") docErrors.set(peer.serverId, result);
      else if (result) {
        docs.set(peer.serverId, result);
        docErrors.delete(peer.serverId);
      }
    });
    for (const hostId of [...docs.keys(), ...docErrors.keys()]) {
      if (!peers.some((peer) => peer.serverId === hostId)) {
        docs.delete(hostId);
        docErrors.delete(hostId);
      }
    }
    overlay = applyPending(stored());
    emitNow();
    // Marks kept on another host than the chat's own (left from an outage, or from before marks moved
    // to the chat's host) move to the chat's host now that both are reachable.
    const strays = [...docs].flatMap(([hostId, doc]) =>
      Object.keys(doc.entries).filter((key) => keyHost(key) !== hostId && docs.has(keyHost(key))),
    );
    if (strays.length) mutate({ keys: strays, apply: (current) => current });
  }

  /**
   * Writes the batch's keys into one host's copy: the merged state for keys that live there, removal for
   * keys that live elsewhere. Retries on a revision conflict. False when the copy could not be saved.
   */
  async function writeDoc(hostId: string, batch: readonly OverlayOp[], keys: readonly string[]): Promise<boolean> {
    const peer = directory.get(hostId);
    if (!peer) {
      docErrors.set(hostId, "not reachable");
      return false;
    }
    try {
      for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
        if (!docs.has(hostId)) await readDoc(peer);
        const doc = docs.get(hostId);
        if (!doc) return false;
        const after = batch.reduce((current, op) => op.apply(current), stored());
        const next: Record<string, OverlayEntry> = { ...doc.entries };
        for (const key of keys) {
          const entry = after[key];
          if (entry && targetOf(key) === hostId) next[key] = entry;
          else delete next[key];
        }
        const values = { entries: { ...pruneOverlay(next, liveKeys(next), Date.now()) } };
        const result = await peer.rpc(overlayContracts.write, { revision: doc.revision, values });
        if (result.status === "saved") {
          docs.set(hostId, { revision: result.revision, entries: overlaySettings.schema.parse(result.values).entries });
          docErrors.delete(hostId);
          saves += 1;
          return true;
        }
        if (result.status === "invalid") {
          docErrors.set(hostId, result.error);
          return false;
        }
        docs.delete(hostId); // conflict: another client saved first; read its copy and write again
      }
      docErrors.set(hostId, "could not save");
    } catch (error) {
      docErrors.set(hostId, message(error));
      docs.delete(hostId);
    }
    return false;
  }

  async function flush(): Promise<void> {
    if (flushing || !selfId) return;
    flushing = true;
    try {
      while (pendingOps.length) {
        const batch = pendingOps;
        inFlight = batch;
        pendingOps = [];
        const keys = [...new Set(batch.flatMap((op) => op.keys))];
        const owners = new Set(keys.flatMap((key) => targetOf(key) ?? []));
        // Copies of these chats on other hosts are removed only once the chats' own hosts have saved them.
        const holders = [...docs]
          .filter(([hostId, doc]) => !owners.has(hostId) && keys.some((key) => key in doc.entries))
          .map(([hostId]) => hostId);
        let saved = true;
        for (const hostId of owners) saved = (await writeDoc(hostId, batch, keys)) && saved;
        if (saved) for (const hostId of holders) await writeDoc(hostId, batch, keys);
        inFlight = [];
        // A batch that could not be saved stays visible until the next read shows what the hosts hold.
        overlay = applyPending(saved ? stored() : batch.reduce((current, op) => op.apply(current), stored()));
        emitNow();
        directory.notify("overlay", origin);
      }
    } finally {
      flushing = false;
    }
  }

  function mutate(op: OverlayOp) {
    pendingOps.push(op);
    overlay = op.apply(overlay);
    emitNow();
    void flush();
  }

  interface PrefsCopy {
    peer: Peer;
    revision: string;
    /** Null when the stored copy is invalid: it is only overwritten once the user changes a setting. */
    prefs: Prefs | null;
  }

  async function readPrefsCopy(peer: Peer): Promise<PrefsCopy | string> {
    try {
      const result = await peer.rpc(prefsContracts.read, {});
      if (result.status !== "ready") return { peer, revision: result.revision, prefs: null };
      const parsed = prefsSettings.schema.safeParse(result.values);
      return { peer, revision: result.revision, prefs: parsed.success ? withNormalizedLayout(parsed.data) : null };
    } catch (error) {
      return message(error);
    }
  }

  /**
   * Brings the view settings and every reachable host's copy to the newest version. The first time, it
   * settles on one copy: the newest changed one, else this device's copy from before settings moved to
   * the hosts, else this host's copy.
   */
  async function syncPrefsOnce(): Promise<void> {
    const results = await Promise.all(reachablePeers().map(readPrefsCopy));
    const copies = results.filter((result): result is PrefsCopy => typeof result !== "string");
    const failures = results.filter((result): result is string => typeof result === "string");
    if (!copies.length) {
      prefsError = failures[0] ?? null;
      return;
    }
    let newest: Prefs | null = null;
    for (const copy of copies) {
      if (copy.prefs && (!newest || copy.prefs.updatedAt > newest.updatedAt)) newest = copy.prefs;
    }
    const deviceRaw = readDevicePrefs();
    if (!prefsLoaded) {
      const device = parseStoredPrefs(deviceRaw);
      let base: Prefs;
      let stamp: number;
      if (device && (newest?.updatedAt ?? 0) <= SETTLED_STAMP) {
        base = device;
        stamp = Date.now();
      } else if (newest && newest.updatedAt > 0) {
        base = newest;
        stamp = newest.updatedAt;
      } else {
        base = copies.find((copy) => copy.peer.serverId === selfId)?.prefs ?? newest ?? DEFAULT_PREFS;
        stamp = SETTLED_STAMP;
      }
      if (prefsEdited) stamp = Date.now();
      prefs = withNormalizedLayout({ ...base, ...unsavedPatch, updatedAt: stamp });
      unsavedPatch = {};
      prefsLoaded = true;
    } else if (newest && newest.updatedAt > prefs.updatedAt) {
      prefs = newest;
    }
    let error: string | null = failures[0] ?? null;
    let wrote = false;
    for (const copy of copies) {
      if (copy.prefs ? copy.prefs.updatedAt === prefs.updatedAt : !prefsEdited) continue;
      const result = await copy.peer.rpc(prefsContracts.write, { revision: copy.revision, values: { ...prefs } });
      if (result.status === "saved") wrote = true;
      else if (result.status === "conflict") prefsAgain = true;
      else error = result.error;
    }
    prefsError = error;
    // The hosts hold the settings now; the copy earlier versions kept on this device is no longer needed.
    if (deviceRaw !== null && !error) clearDevicePrefs();
    if (wrote) directory.notify("prefs", origin);
  }

  async function syncPrefs(): Promise<void> {
    if (!selfId) return;
    if (prefsSyncing) {
      prefsAgain = true;
      return;
    }
    prefsSyncing = true;
    try {
      do {
        prefsAgain = false;
        try {
          await syncPrefsOnce();
        } catch (error) {
          prefsError = message(error);
        }
        emitNow();
      } while (prefsAgain);
    } finally {
      prefsSyncing = false;
    }
  }

  function updatePrefs(patch: Partial<Prefs>) {
    prefsEdited = true;
    if (!prefsLoaded) unsavedPatch = { ...unsavedPatch, ...patch };
    prefs = withNormalizedLayout({ ...prefs, ...patch, updatedAt: Date.now() });
    if (prefsTimer !== undefined) clearTimeout(prefsTimer); // React Native's clearTimeout type rejects undefined
    prefsTimer = setTimeout(() => void syncPrefs(), PREFS_SAVE_DELAY_MS);
    emitNow();
  }

  function start() {
    started = true;
    reconcile();
    reconcileTimer = setInterval(reconcile, RECONCILE_MS);
    overlayTimer = setInterval(() => void readOverlay(), OVERLAY_REFRESH_MS);
    prefsRefreshTimer = setInterval(() => void syncPrefs(), PREFS_REFRESH_MS);
    void readOverlay();
    void syncPrefs();
  }

  function stop() {
    if (reconcileTimer !== undefined) {
      clearInterval(reconcileTimer);
      reconcileTimer = undefined;
    }
    if (overlayTimer !== undefined) {
      clearInterval(overlayTimer);
      overlayTimer = undefined;
    }
    if (prefsRefreshTimer !== undefined) {
      clearInterval(prefsRefreshTimer);
      prefsRefreshTimer = undefined;
    }
    for (const entry of observers.values()) entry.observer.stop();
    observers.clear();
    hostData.clear();
    started = false;
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    retain() {
      if (stopTimer !== undefined) {
        clearTimeout(stopTimer);
        stopTimer = undefined;
      }
      // Re-retained inside the grace period: the observers and timers are still running.
      if (++consumers === 1 && !started) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--consumers === 0) stopTimer = setTimeout(stop, STOP_GRACE_MS);
      };
    },
    setHosts(next) {
      const same =
        next.length === hosts.length &&
        next.every((host, i) => {
          const old = hosts[i];
          return old && old.serverId === host.serverId && old.status === host.status && old.label === host.label;
        });
      if (same) return;
      hosts = next;
      if (consumers === 0) {
        emitNow();
        return;
      }
      reconcile();
      // Which hosts' copies are reachable may have changed.
      void readOverlay();
      void syncPrefs();
    },
    markRead: (keys) => mutate({ keys, apply: (current) => markRead(current, keys, Date.now()) }),
    markUnread: (key) => mutate({ keys: [key], apply: (current) => markUnread(current, key, Date.now()) }),
    setPinned: (key, pinned) =>
      mutate({ keys: [key], apply: (current) => (pinned ? pinChat(current, key, Date.now()) : unpinChat(current, key)) }),
    updatePrefs,
    toggleHost: (hostId) =>
      updatePrefs({ hiddenHosts: toggleHiddenHost(prefs.hiddenHosts, hostId, hosts.map((host) => host.serverId)) }),
    toggleSort: (section) =>
      updatePrefs({ sectionSort: { ...prefs.sectionSort, [section]: prefs.sectionSort[section] === "oldest" ? "newest" : "oldest" } }),
    async renameChat(key, title) {
      const peer = directory.get(keyHost(key));
      // Only that host's plugin can rename its chat; an older version there has no rename yet.
      if (!peer) throw new Error("That chat's host does not run a current Recent Chats.");
      await peer.rpc(renameChat, { agentId: key.slice(key.indexOf(":") + 1), title });
    },
    async checkForUpdates() {
      const label = (hostId: string) => hosts.find((host) => host.serverId === hostId)?.label ?? hostId;
      return Promise.all(
        reachablePeers().map(async (peer) => {
          try {
            const { result } = await peer.rpc(checkForUpdate, {});
            return { host: label(peer.serverId), result, failed: false };
          } catch (error) {
            return { host: label(peer.serverId), result: message(error), failed: true };
          }
        }),
      );
    },
    dispose() {
      if (stopTimer !== undefined) {
        clearTimeout(stopTimer);
        stopTimer = undefined;
      }
      if (emitTimer !== undefined) {
        clearTimeout(emitTimer);
        emitTimer = undefined;
      }
      if (prefsTimer !== undefined) {
        clearTimeout(prefsTimer);
        prefsTimer = undefined;
      }
      stop();
      unsubscribe();
      unregister?.();
      listeners.clear();
    },
  };
}
