// The one store of this plugin installation, created by the client entry and read by every surface,
// plus the entry's navigation actions for surfaces that are not handed them as props.
import type { ProjectRef } from "@getpaseo/plugin/client";
import type { RecentsStore } from "./store";

export const SETTINGS_SCREEN_ID = "recent-chats";

let current: RecentsStore | null = null;
let openSettings: (() => void) | null = null;

export function setStore(store: RecentsStore | null): void {
  current = store;
}

export function getStore(): RecentsStore {
  if (!current) throw new Error("Recent Chats store is not initialised");
  return current;
}

export function setSettingsOpener(opener: (() => void) | null): void {
  openSettings = opener;
}

/** Opens this plugin's settings screen. */
export function openPluginSettings(): void {
  openSettings?.();
}

/** Opens Paseo's own new-workspace screen for a project, filled in for it (Paseo 0.16 and later). */
let projectOpener: ((ref: ProjectRef) => void) | null = null;

export function setProjectOpener(opener: ((ref: ProjectRef) => void) | null): void {
  projectOpener = opener;
}

export const getProjectOpener = (): ((ref: ProjectRef) => void) | null => projectOpener;
