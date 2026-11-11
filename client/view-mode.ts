// Trial of the projects view: which view the sidebar shows, "active only", and the project and
// workspace pins. Kept on this device (browser or desktop profile), not synced, so trying it changes
// nothing elsewhere. Phones keep it in memory. Shared on globalThis so every host's copy of the plugin
// in this app shows the same.
import { useSyncExternalStore } from "react";
import { readDeviceValue, writeDeviceValue } from "./web";

const KEY = "__paseoRecentChats.viewMode.v1";
const STORAGE_KEY = "paseo-recent-chats:view-mode:v1";

export interface ViewMode {
  view: "triage" | "projects";
  activeOnly: boolean;
  /** Tree keys of pinned projects (`project:`) and workspaces (`workspace:`). Chat pins are the synced ones. */
  pins: readonly string[];
  /** Tree nodes switched from their default: folded hosts, projects and workspaces, opened "+N older" and quiet lists. */
  toggled: readonly string[];
  /** Group the projects tree by host. Off: one list of projects, each with its host's tag. */
  groupHosts: boolean;
}

const DEFAULTS: ViewMode = { view: "triage", activeOnly: true, pins: [], toggled: [], groupHosts: true };
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);

interface Shared {
  value: ViewMode;
  listeners: Set<() => void>;
}

function load(): ViewMode {
  try {
    const raw = readDeviceValue(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<ViewMode>;
    return {
      view: parsed.view === "projects" ? "projects" : "triage",
      activeOnly: parsed.activeOnly !== false,
      pins: strings(parsed.pins),
      toggled: strings(parsed.toggled),
      groupHosts: parsed.groupHosts !== false,
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
  writeDeviceValue(STORAGE_KEY, JSON.stringify(state.value));
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

const flip = (list: readonly string[], key: string) => (list.includes(key) ? list.filter((item) => item !== key) : [...list, key]);

export const togglePin = (key: string): void => updateViewMode({ pins: flip(shared().value.pins, key) });
export const toggleNode = (key: string): void => updateViewMode({ toggled: flip(shared().value.toggled, key) });

/** Unfolds the given tree nodes (and opens the listed toggles) so a search result can be shown. */
export function revealNodes(unfold: readonly string[], open: readonly string[] = []): void {
  const toggled = shared().value.toggled.filter((key) => !unfold.includes(key));
  updateViewMode({ toggled: [...toggled, ...open.filter((key) => !toggled.includes(key))] });
}

export const currentViewMode = (): ViewMode => shared().value;

export function useViewMode(): ViewMode {
  return useSyncExternalStore((listener) => {
    const state = shared();
    state.listeners.add(listener);
    return () => void state.listeners.delete(listener);
  }, currentViewMode);
}
