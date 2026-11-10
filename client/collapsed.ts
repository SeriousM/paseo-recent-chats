// Which groups of the list are folded away. Kept in memory only, so it lasts while the app runs and
// every mounted list (sidebar, popup, screen) of this plugin copy shows the same; not a setting.
import { useSyncExternalStore } from "react";

const collapsed = new Set<string>();
const listeners = new Set<() => void>();
let version = 0;

/** Key of a section's group: per host when rows are grouped by host, else for the whole list. */
export const sectionGroupKey = (section: string, hostId: string | null): string =>
  hostId === null ? `section:${section}` : `section:${hostId}:${section}`;

export const hostGroupKey = (hostId: string): string => `host:${hostId}`;

export function toggleCollapsed(key: string): void {
  if (!collapsed.delete(key)) collapsed.add(key);
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** The folded group keys; re-renders the caller whenever a group is folded or unfolded. */
export function useCollapsed(): ReadonlySet<string> {
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => version,
  );
  return collapsed;
}
