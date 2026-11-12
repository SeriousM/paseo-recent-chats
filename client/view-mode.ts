// How the sidebar list looks on this device: Triage or Projects, "active only", and which tree nodes are
// folded. Kept on this device (browser or desktop profile), not synced: a phone and a desktop choose
// separately. Phones keep it in memory. Shared on globalThis so every host's copy of the plugin in this
// app shows the same. Pins of projects and workspaces are synced settings (prefs.treePins).
import { useSyncExternalStore } from "react";
import { readDeviceValue, writeDeviceValue } from "./web";

const KEY = "__paseoRecentChats.viewMode.v1";
const STORAGE_KEY = "paseo-recent-chats:view-mode:v1";

export interface ViewMode {
  /** Null until chosen on this device: Projects on wide screens, Triage on phones. */
  view: "triage" | "projects" | null;
  activeOnly: boolean;
  /** Tree nodes switched from their default: folded hosts, projects and workspaces, opened "+N older" and quiet lists. */
  toggled: readonly string[];
  /** Project and workspace pins made before pins were synced; moved to the settings once (see sidebar-item). */
  legacyPins: readonly string[];
}

const DEFAULTS: ViewMode = { view: null, activeOnly: true, toggled: [], legacyPins: [] };
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

interface Shared {
  value: ViewMode;
  listeners: Set<() => void>;
}

function load(): ViewMode {
  try {
    const raw = readDeviceValue(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULTS;
    const stored = parsed as Record<string, unknown>;
    return {
      view: stored.view === "projects" || stored.view === "triage" ? stored.view : null,
      activeOnly: stored.activeOnly !== false,
      toggled: strings(stored.toggled),
      legacyPins: strings(stored.pins),
    };
  } catch {
    return DEFAULTS;
  }
}

function shared(scope: object = globalThis): Shared {
  const holder = scope as Record<string, Shared | undefined>;
  return (holder[KEY] ??= { value: load(), listeners: new Set() });
}

export function updateViewMode(patch: Partial<ViewMode>): void {
  const state = shared();
  state.value = { ...state.value, ...patch };
  const { view, activeOnly, toggled, legacyPins } = state.value;
  writeDeviceValue(STORAGE_KEY, JSON.stringify({ view, activeOnly, toggled, pins: legacyPins }));
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

/** Adds `key` when missing, removes it when present. */
export const flip = (list: readonly string[], key: string): string[] =>
  list.includes(key) ? list.filter((item) => item !== key) : [...list, key];

export const toggleNode = (key: string): void => updateViewMode({ toggled: flip(shared().value.toggled, key) });

/** The view shown: the one chosen on this device, else Projects on wide screens and Triage on phones. */
export const resolvedView = (mode: ViewMode, compact: boolean): "triage" | "projects" =>
  mode.view ?? (compact ? "triage" : "projects");

export const currentViewMode = (): ViewMode => shared().value;

export function useViewMode(): ViewMode {
  return useSyncExternalStore((listener) => {
    const state = shared();
    state.listeners.add(listener);
    return () => void state.listeners.delete(listener);
  }, currentViewMode);
}
