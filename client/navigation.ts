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
