// Opening workspaces and starting new ones from the ⋮ menus. The 0.16 sidebar view uses Paseo's own
// navigation; the sidebar item and the phone screen open workspaces through the go screen and start new ones
// on Paseo's own new-workspace screen (useNewWorkspace).
// Where no provider is set (pills, older apps) the menus leave these items out.
import * as pluginClient from "@getpaseo/plugin/client";
import type { ProjectRef, TerminalRef } from "@getpaseo/plugin/client";
import { createContext, useContext, useEffect, useRef } from "react";
import { Platform } from "react-native";
import { getProjectOpener, getTerminalCreator, getTerminalOpener } from "./runtime";
import { sendPaseoShortcut } from "./web";

export interface PaseoNavigation {
  openWorkspace(hostId: string, workspaceId: string): void;
  /** Starts a new workspace in a project; a rejection is shown as a toast by the menu. */
  newWorkspace(hostId: string, projectId: string): void | Promise<void>;
  /** Opens a new terminal tab in the workspace (useWorkspaceCreators). */
  newTerminal?: (hostId: string, workspaceId: string) => Promise<void>;
  /** Opens a new agent tab in the workspace; absent where it cannot (phones). */
  newAgent?: ((hostId: string, workspaceId: string) => void) | null;
}

export const NavigationContext = createContext<PaseoNavigation | null>(null);

export const usePaseoNavigation = (): PaseoNavigation | null => useContext(NavigationContext);

/**
 * Paseo's own way to open a chat, published by the 0.16 sidebar view while it is shown. Keys (back and
 * forward, Alt+Shift+number) prefer it to the go screen: opening a chat through a plugin screen leaves that
 * screen behind as a hidden tab holding a second copy of the chat, whose composer pills Paseo then draws
 * twice (the stray popup in the window corner). Shared on globalThis, since the copy that renders the sidebar
 * view is not necessarily the one handling the keys; a contract between plugin versions like peers.ts.
 */
type DirectOpener = (input: { readonly agentId: string; readonly serverId?: string }) => void;
const OPENER_KEY = "__paseoRecentChats.directOpener.v1";

export function publishDirectOpener(open: DirectOpener): () => void {
  const holder = globalThis as unknown as Record<string, DirectOpener | undefined>;
  holder[OPENER_KEY] = open;
  return () => {
    if (holder[OPENER_KEY] === open) delete holder[OPENER_KEY];
  };
}

export const directOpener = (): DirectOpener | undefined => (globalThis as unknown as Record<string, DirectOpener | undefined>)[OPENER_KEY];

/**
 * "New workspace" for any surface: opens Paseo's own new-workspace screen for the project, filled in for it,
 * the way Ctrl+N does. Paseo picks a worktree or the folder itself, so projects that are not git repositories
 * work too. Throws (shown as a toast by the menu) where the app cannot open it.
 */
export function useNewWorkspace(): (hostId: string, projectId: string) => void {
  const refs = useProjectRefs();
  return (hostId, projectId) => {
    const ref = refs.find((candidate) => candidate.hostId === hostId && candidate.id === projectId);
    const open = getProjectOpener();
    if (!ref || !open) throw new Error("This version of Paseo cannot open a new workspace from a plugin.");
    open(ref);
  };
}

// Only Paseo 0.16 has useProjects; through the namespace it is just absent in older apps.
const useProjectRefs: () => readonly ProjectRef[] =
  typeof (pluginClient as { useProjects?: unknown }).useProjects === "function" ? () => pluginClient.useProjects() : () => [];

/**
 * "New terminal" and "New agent" for a workspace, for any surface. A terminal is created in the workspace and
 * its tab opened once Paseo lists it. A new agent opens the workspace and sends Paseo's own New agent tab
 * shortcut (Ctrl+Shift+A), since plugins get no call for that tab: desktop and web only, so it is null elsewhere.
 */
export function useWorkspaceCreators(openWorkspace: (hostId: string, workspaceId: string) => void): {
  newTerminal: (hostId: string, workspaceId: string) => Promise<void>;
  newAgent: ((hostId: string, workspaceId: string) => void) | null;
} {
  const terminals = useTerminalRefs();
  const pending = useRef<{ hostId: string; id: string; until: number } | null>(null);
  // The terminal's tab opens once Paseo lists it (the reference has to be Paseo's own).
  useEffect(() => {
    const wanted = pending.current;
    if (!wanted || Date.now() > wanted.until) return;
    const ref = terminals.find((candidate) => candidate.hostId === wanted.hostId && candidate.id === wanted.id);
    const open = getTerminalOpener();
    if (!ref || !open) return;
    pending.current = null;
    open(ref);
  }, [terminals]);
  return {
    async newTerminal(hostId, workspaceId) {
      const create = getTerminalCreator();
      if (!create || !getTerminalOpener()) throw new Error("This version of Paseo cannot open a terminal from a plugin.");
      pending.current = { hostId, id: await create(hostId, workspaceId), until: Date.now() + 10_000 };
    },
    newAgent:
      Platform.OS === "web"
        ? (hostId, workspaceId) => {
            openWorkspace(hostId, workspaceId);
            // Once the workspace is the one on screen, which takes a moment.
            setTimeout(() => sendPaseoShortcut("A", "KeyA", true), 400);
          }
        : null,
  };
}

// Only Paseo 0.16 has useTerminals; through the namespace it is just absent in older apps.
const useTerminalRefs: () => readonly TerminalRef[] =
  typeof (pluginClient as { useTerminals?: unknown }).useTerminals === "function" ? () => pluginClient.useTerminals() : () => [];
