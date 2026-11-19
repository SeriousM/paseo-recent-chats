// The one store of this plugin installation, created by the client entry and read by every surface,
// plus the entry's navigation actions for surfaces that are not handed them as props.
import type { ProjectRef, TerminalRef } from "@getpaseo/plugin/client";
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

/** Opens a terminal tab by Paseo's reference to it (Paseo 0.16 and later). */
let terminalOpener: ((ref: TerminalRef) => void) | null = null;

export function setTerminalOpener(opener: ((ref: TerminalRef) => void) | null): void {
  terminalOpener = opener;
}

export const getTerminalOpener = (): ((ref: TerminalRef) => void) | null => terminalOpener;

/** Creates a terminal in a workspace and resolves to its id. */
let terminalCreator: ((hostId: string, workspaceId: string) => Promise<string>) | null = null;

export function setTerminalCreator(creator: ((hostId: string, workspaceId: string) => Promise<string>) | null): void {
  terminalCreator = creator;
}

export const getTerminalCreator = (): ((hostId: string, workspaceId: string) => Promise<string>) | null => terminalCreator;
