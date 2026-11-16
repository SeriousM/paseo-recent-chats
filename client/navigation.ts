// Paseo's own navigation for workspaces and projects. Only the 0.16 sidebar view is handed it; the menus
// leave out what it offers wherever it is missing (the sidebar item, pills, older apps).
import { createContext, useContext } from "react";

export interface PaseoNavigation {
  openWorkspace(hostId: string, workspaceId: string): void;
  /** Starts Paseo's new-workspace flow for a project. */
  newWorkspace(hostId: string, projectId: string): void;
}

export const NavigationContext = createContext<PaseoNavigation | null>(null);

export const usePaseoNavigation = (): PaseoNavigation | null => useContext(NavigationContext);
