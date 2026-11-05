// Pure helpers for the view preferences kept outside the host store.
import { prefsSettings, type Prefs } from "../shared/settings";
import { normalizeLayout } from "./row-layout";

export const DEFAULT_PREFS: Prefs = withNormalizedLayout(prefsSettings.schema.parse({}));

export function withNormalizedLayout(prefs: Prefs): Prefs {
  return { ...prefs, layout: normalizeLayout(prefs.layout) };
}

/** Validates stored JSON. Missing fields take their defaults; unreadable or invalid text gives null. */
export function parseStoredPrefs(raw: string | null): Prefs | null {
  if (!raw) return null;
  try {
    const parsed = prefsSettings.schema.safeParse(JSON.parse(raw));
    return parsed.success ? withNormalizedLayout(parsed.data) : null;
  } catch {
    return null;
  }
}

/** Switch one host on or off in the filter. Ids of hosts that no longer exist are dropped. */
export function toggleHiddenHost(
  hidden: readonly string[],
  hostId: string,
  knownHostIds: readonly string[],
): string[] {
  const next = new Set(hidden.filter((id) => knownHostIds.includes(id)));
  if (next.has(hostId)) next.delete(hostId);
  else next.add(hostId);
  return [...next];
}
