// The only module that touches a DOM global. Every export is gated on Platform.OS === "web".
import { Platform } from "react-native";
import { parseHostColorNames } from "./format";

declare const localStorage: {
  getItem(key: string): string | null;
  removeItem(key: string): void;
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

/** Where earlier versions kept the view preferences on web and desktop. Read once to move them to the hosts. */
const PREFS_KEY = "paseo-recent-chats:prefs:v1";

export function readDevicePrefs(): string | null {
  if (Platform.OS !== "web") return null;
  try {
    return localStorage.getItem(PREFS_KEY);
  } catch {
    return null;
  }
}

/** Forgets the device copy once the hosts hold the settings. */
export function clearDevicePrefs(): void {
  if (Platform.OS !== "web") return;
  try {
    localStorage.removeItem(PREFS_KEY);
  } catch {
    // Blocked storage: the copy stays, and is ignored because the hosts already hold newer settings.
  }
}
