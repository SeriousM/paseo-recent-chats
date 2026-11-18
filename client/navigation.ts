// Opening workspaces and starting new ones from the ⋮ menus. The 0.16 sidebar view uses Paseo's own
// navigation; the sidebar item creates the workspace itself and opens it through the go screen.
// Where no provider is set (pills, older apps) the menus leave these items out.
import { createContext, useContext } from "react";

export interface PaseoNavigation {
  openWorkspace(hostId: string, workspaceId: string): void;
  /** Starts a new workspace in a project; a rejection is shown as a toast by the menu. */
  newWorkspace(hostId: string, projectId: string): void | Promise<void>;
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
