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

