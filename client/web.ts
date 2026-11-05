// The only module that touches a DOM global. Every export is gated on Platform.OS === "web".
import { Platform } from "react-native";
import { parseHostColorNames } from "./format";

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

/** Where the Paseo web and desktop app save the host list, including each host's colour. */
const HOST_LIST_KEY = "@paseo:daemon-registry";

/**
 * serverId -> colour name the user picked for the host in Paseo. The plugin SDK does not expose it,
 * so it is read from the app's own saved host list. Empty on iOS and Android, where that list is
 * not reachable; hosts then show without a colour.
 */
export function readHostColorNames(): Record<string, string> {
  if (Platform.OS !== "web") return {};
  try {
    return parseHostColorNames(localStorage.getItem(HOST_LIST_KEY));
  } catch {
    return {};
  }
}

/** Where this device keeps the view preferences. One key per browser or desktop profile. */
const PREFS_KEY = "paseo-recent-chats:prefs:v1";

/** True where this device can keep preferences itself: web and desktop, not private modes that block storage. */
export function deviceStorageAvailable(): boolean {
  if (Platform.OS !== "web") return false;
  try {
    localStorage.getItem(PREFS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function readDevicePrefs(): string | null {
  if (!deviceStorageAvailable()) return null;
  try {
    return localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

/** Returns false when the browser refused the write (quota, blocked storage). */
export function writeDevicePrefs(json: string): boolean {
  if (!deviceStorageAvailable()) return false;
  try {
    localStorage.setItem(PREFS_KEY, json);
    return true;
  } catch {
    return false;
  }
}
