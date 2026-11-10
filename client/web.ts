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

interface DomPointerEvent {
  clientY: number;
  button: number;
  preventDefault(): void;
  stopPropagation(): void;
}

interface DomTarget {
  addEventListener(type: string, listener: (event: DomPointerEvent) => void): void;
  removeEventListener(type: string, listener: (event: DomPointerEvent) => void): void;
}

declare const window: DomTarget;

function isDomTarget(node: unknown): node is DomTarget {
  return typeof node === "object" && node !== null && "addEventListener" in node && "removeEventListener" in node;
}

/**
 * Vertical mouse/pen/touch drag on a web element. The app's sidebar sorts its items with pointer-event
 * drag and drop, which takes the mouse before React Native's responder sees it, so the grip handles
 * pointer events itself and keeps them from reaching the sidebar. Returns a cleanup; a no-op off the web.
 */
export function attachVerticalDrag(
  node: unknown,
  handlers: { start(): void; move(dy: number): void; end(): void },
): () => void {
  if (Platform.OS !== "web" || !isDomTarget(node)) return () => {};
  let startY = 0;
  const move = (event: DomPointerEvent) => {
    event.preventDefault();
    handlers.move(event.clientY - startY);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    handlers.end();
  };
  const down = (event: DomPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    startY = event.clientY;
    handlers.start();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  node.addEventListener("pointerdown", down);
  return () => {
    node.removeEventListener("pointerdown", down);
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
  };
}
