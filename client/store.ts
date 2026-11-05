// One store shared by every surface (sidebar, pill popups, screens). Closure based: no classes (Hermes).
// Observes every online host, owns the read/unread overlay and the prefs copy used outside React.
import { getPaseoClient, type PluginCommandCapabilities, type PluginHostSummary } from "@getpaseo/plugin/client";
import { settingsRpc } from "@getpaseo/plugin";
import { createHostObserver, type HostData, type HostObserver } from "./host-observer";
import { markRead, markUnread, pinChat, pruneOverlay, unpinChat } from "./overlay";
import type { PaseoAgent, PaseoApi } from "./paseo-types";
import { chatKey, isDelegated, type ChatInput, type Overlay } from "./triage";
import { deviceStorageAvailable, readDevicePrefs, readHostColorNames, writeDevicePrefs } from "./web";
import { agentLabel } from "./format";
import { DEFAULT_PREFS, parseStoredPrefs, toggleHiddenHost, withNormalizedLayout } from "./prefs";
import { overlaySettings, prefsSettings, type Prefs } from "../shared/settings";

export type Rpc = PluginCommandCapabilities["rpc"];

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
  /** Where the view preferences live: on this device (web and desktop) or on the host (phones). */
  prefsStorage: "device" | "host";
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
  /** Pin or unpin a chat. Pinned chats are listed first. */
  setPinned(key: string, pinned: boolean): void;
  /** Change view preferences. Applied at once, then saved to the device or the host. */
  updatePrefs(patch: Partial<Prefs>): void;
  /** Switch one host on or off in the host filter. */
  toggleHost(hostId: string): void;
  /** Stops observation and drops every listener. Called when the plugin unloads. */
  dispose(): void;
}

const EMIT_DELAY_MS = 250;
const RECONCILE_MS = 15_000;
const OVERLAY_REFRESH_MS = 60_000;
const STOP_GRACE_MS = 5_000;
const WRITE_ATTEMPTS = 4;

const PREFS_SAVE_DELAY_MS = 500;

const overlayContracts = settingsRpc(overlaySettings.id);
const prefsContracts = settingsRpc(prefsSettings.id);

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

export function createStore(rpc: Rpc): RecentsStore {
  const listeners = new Set<() => void>();
  const observers = new Map<string, { api: PaseoApi; observer: HostObserver }>();
  const hostData = new Map<string, HostData>();
  const hostErrors = new Map<string, string>();
  let hosts: readonly PluginHostSummary[] = [];
  let prefs: Prefs = DEFAULT_PREFS;
  const prefsStorage: "device" | "host" = deviceStorageAvailable() ? "device" : "host";
  let prefsRevision: string | null = null;
  let prefsEdited = false;
  /** The stored copy has been read (or the user has chosen settings), so defaults may not overwrite it. */
  let prefsLoaded = false;
  let prefsLoading = false;
  /** Edits made before the stored copy could be read; applied on top of it once it is. */
  let unsavedPatch: Partial<Prefs> = {};
  let prefsSaving = false;
  let prefsDirty = false;
  let prefsError: string | null = null;
  let prefsTimer: ReturnType<typeof setTimeout> | undefined;
  let overlay: Overlay = {};
  let remote: { revision: string; entries: Overlay } | null = null;
  let hostColors: Record<string, string> = {};
  let pendingOps: ((overlay: Overlay) => Overlay)[] = [];
  /** The batch being written; still shown as applied until the write is done. */
  let inFlight: ((overlay: Overlay) => Overlay)[] = [];
  let flushing = false;
  let started = false;
  let overlayError: string | null = null;
  let consumers = 0;
  let reconcileTimer: ReturnType<typeof setInterval> | undefined;
  let overlayTimer: ReturnType<typeof setInterval> | undefined;
  let stopTimer: ReturnType<typeof setTimeout> | undefined;
  let emitTimer: ReturnType<typeof setTimeout> | undefined;
  let snapshot: StoreSnapshot = buildSnapshot();

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
    for (const [hostId, error] of hostErrors) {
      const label = hosts.find((host) => host.serverId === hostId)?.label ?? hostId;
      errors.push(`${label}: ${error}`);
    }
    if (overlayError) errors.push(`Read state: ${overlayError}`);
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
      prefsStorage,
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
    if (!prefsLoaded) void loadPrefs();
    emitNow();
  }

  /** Overlay keys of hosts that are not loaded are kept; vanished chats on loaded hosts are pruned. */
  function liveKeys(): ReadonlySet<string> | null {
    const live = new Set<string>();
    for (const [hostId, data] of hostData) {
      if (data.loading || data.error) continue;
      for (const agent of data.agents) live.add(chatKey(hostId, agent.id));
    }
    const settled = new Set([...hostData].filter(([, data]) => !data.loading && !data.error).map(([id]) => id));
    for (const key of Object.keys(overlay)) {
      if (!settled.has(key.slice(0, key.indexOf(":")))) live.add(key);
    }
    return live;
  }

  const applyPending = (base: Overlay): Overlay =>
    [...inFlight, ...pendingOps].reduce((current, op) => op(current), base);

  /** Reads the host's copy. While a write is under way the periodic read waits (`force` is for the write itself). */
  async function readOverlay(force = false): Promise<void> {
    if (flushing && !force) return;
    try {
      const result = await rpc(overlayContracts.read, {});
      if (result.status !== "ready") throw new Error(result.error);
      const parsed = overlaySettings.schema.parse(result.values);
      remote = { revision: result.revision, entries: parsed.entries };
      overlayError = null;
      overlay = applyPending(parsed.entries);
    } catch (error) {
      overlayError = error instanceof Error ? error.message : String(error);
    }
    emitNow();
  }

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      while (pendingOps.length) {
        const batch = pendingOps;
        inFlight = batch;
        pendingOps = [];
        let saved = false;
        for (let attempt = 0; attempt < WRITE_ATTEMPTS && !saved; attempt++) {
          if (!remote) await readOverlay(true);
          if (!remote) break;
          const merged = pruneOverlay(
            batch.reduce((current, op) => op(current), remote.entries),
            liveKeys(),
            Date.now(),
          );
          const result = await rpc(overlayContracts.write, { revision: remote.revision, values: { entries: { ...merged } } });
          if (result.status === "saved") {
            remote = { revision: result.revision, entries: overlaySettings.schema.parse(result.values).entries };
            overlayError = null;
            saved = true;
          } else if (result.status === "conflict") {
            remote = null;
          } else {
            overlayError = result.error;
            break;
          }
        }
        if (!saved) {
          overlayError ??= "could not save";
          remote = null;
        }
        inFlight = [];
        overlay = applyPending(remote?.entries ?? overlay);
        emitNow();
      }
    } catch (error) {
      overlayError = error instanceof Error ? error.message : String(error);
      inFlight = [];
      remote = null;
      emitNow();
    } finally {
      flushing = false;
    }
  }

  function mutate(op: (overlay: Overlay) => Overlay) {
    pendingOps.push(op);
    overlay = op(overlay);
    emitNow();
    void flush();
  }

  /** Reads the host's copy of the preferences. Also remembers its revision for the next write. */
  async function readHostPrefs(): Promise<Prefs | null> {
    try {
      const result = await rpc(prefsContracts.read, {});
      if (result.status !== "ready") return null;
      prefsRevision = result.revision;
      const parsed = prefsSettings.schema.safeParse(result.values);
      return parsed.success ? withNormalizedLayout(parsed.data) : null;
    } catch {
      return null;
    }
  }

  async function loadPrefs(): Promise<void> {
    if (prefsLoading || prefsLoaded) return;
    prefsLoading = true;
    try {
      let loaded: Prefs | null = null;
      if (prefsStorage === "device") {
        const raw = readDevicePrefs();
        loaded = parseStoredPrefs(raw);
        if (!loaded && raw === null) {
          // First run on this device: adopt what the host already had, so earlier choices are not lost.
          loaded = await readHostPrefs();
        }
        // A stored copy that exists but cannot be read stays untouched until the user changes a setting.
        prefsLoaded = loaded !== null || raw !== null;
      } else {
        loaded = await readHostPrefs();
        prefsLoaded = loaded !== null;
      }
      // Edits made while loading win over the stored copy; if nothing could be read, defaults are shown
      // but not saved, and the next reconcile tries again.
      if (loaded) prefs = withNormalizedLayout({ ...loaded, ...unsavedPatch });
      else if (!prefsEdited) prefs = DEFAULT_PREFS;
      if (prefsLoaded) unsavedPatch = {};
      // The adopted host copy (or an edit merged into it) becomes this device's stored copy.
      if (loaded && prefsStorage === "device" && (prefsEdited || readDevicePrefs() === null)) {
        writeDevicePrefs(JSON.stringify(prefs));
      }
    } finally {
      prefsLoading = false;
    }
    emitNow();
  }

  async function saveHostPrefsOnce(): Promise<void> {
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt++) {
      if (prefsRevision === null) {
        const current = await readHostPrefs();
        if (current && !prefsLoaded) {
          // Settings could not be read at start-up: build on the host's copy instead of overwriting it with defaults.
          prefs = withNormalizedLayout({ ...current, ...unsavedPatch });
          unsavedPatch = {};
          prefsLoaded = true;
        }
      }
      if (prefsRevision === null) throw new Error("the host did not answer");
      const result = await rpc(prefsContracts.write, { revision: prefsRevision, values: { ...prefs } });
      if (result.status === "saved") {
        prefsRevision = result.revision;
        prefsError = null;
        return;
      }
      if (result.status === "invalid") throw new Error(result.error);
      prefsRevision = null; // conflict: another client saved first, take its revision and write again
    }
    throw new Error("too many conflicting changes");
  }

  async function saveHostPrefs(): Promise<void> {
    if (prefsSaving) {
      prefsDirty = true;
      return;
    }
    prefsSaving = true;
    try {
      do {
        prefsDirty = false;
        try {
          await saveHostPrefsOnce();
        } catch (error) {
          prefsError = error instanceof Error ? error.message : String(error);
        }
        emitNow();
      } while (prefsDirty);
    } finally {
      prefsSaving = false;
    }
  }

  function persistPrefs() {
    if (prefsStorage === "device") {
      prefsError = writeDevicePrefs(JSON.stringify(prefs)) ? null : "this browser blocked saving";
      // The user's own settings now exist on this device; later reads must not replace them with the host's.
      prefsLoaded = true;
      return;
    }
    if (prefsTimer !== undefined) clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => void saveHostPrefs(), PREFS_SAVE_DELAY_MS);
  }

  function updatePrefs(patch: Partial<Prefs>) {
    prefsEdited = true;
    if (!prefsLoaded) unsavedPatch = { ...unsavedPatch, ...patch };
    prefs = withNormalizedLayout({ ...prefs, ...patch });
    persistPrefs();
    emitNow();
  }

  function start() {
    started = true;
    reconcile();
    reconcileTimer = setInterval(reconcile, RECONCILE_MS);
    overlayTimer = setInterval(() => void readOverlay(), OVERLAY_REFRESH_MS);
    void readOverlay();
    void loadPrefs();
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
      if (consumers > 0) reconcile();
      else emitNow();
    },
    markRead: (keys) => mutate((current) => markRead(current, keys, Date.now())),
    markUnread: (key) => mutate((current) => markUnread(current, key, Date.now())),
    setPinned: (key, pinned) =>
      mutate((current) => (pinned ? pinChat(current, key, Date.now()) : unpinChat(current, key))),
    updatePrefs,
    toggleHost: (hostId) =>
      updatePrefs({ hiddenHosts: toggleHiddenHost(prefs.hiddenHosts, hostId, hosts.map((host) => host.serverId)) }),
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
      listeners.clear();
    },
  };
}
