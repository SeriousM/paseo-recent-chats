// The only module that touches a DOM global. Every export is gated on Platform.OS === "web".
import { Platform } from "react-native";
import { parseHostColorNames } from "./format";

declare const localStorage: {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
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

/** Where the Paseo web and desktop app save its own settings, including the interface font size. */
const APP_SETTINGS_KEY = "@paseo:app-settings";

/**
 * The interface font size chosen in Paseo (Settings, Appearance), in px; null when it cannot be read
 * (phones, or never changed). The plugin SDK does not expose it, so it is read from the app's settings.
 */
export function readUiFontSize(): number | null {
  if (Platform.OS !== "web") return null;
  try {
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    const settings: unknown = raw ? JSON.parse(raw) : null;
    if (typeof settings !== "object" || settings === null || !("uiBaseFontSize" in settings)) return null;
    const size = settings.uiBaseFontSize;
    return typeof size === "number" && size > 0 ? size : null;
  } catch {
    return null;
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

/** A value kept on this device (web and desktop); null on phones or when storage is blocked. */
export function readDeviceValue(key: string): string | null {
  if (Platform.OS !== "web") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Stores a value on this device; a no-op on phones or when storage is blocked. */
export function writeDeviceValue(key: string, value: string): void {
  if (Platform.OS !== "web") return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the value lasts until the app restarts.
  }
}

interface DomPointerEvent {
  clientX: number;
  clientY: number;
  pointerType: string;
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
 * pointer events itself and keeps them from reaching the sidebar. With `touchHoldMs`, a finger has to rest
 * that long before the drag starts (moving 10 px earlier cancels it); mouse and pen start at once.
 * Returns a cleanup; a no-op off the web.
 */
export function attachVerticalDrag(
  node: unknown,
  handlers: { start(): void; move(dy: number): void; end(): void },
  touchHoldMs = 0,
): () => void {
  if (Platform.OS !== "web" || !isDomTarget(node)) return () => {};
  let startX = 0;
  let startY = 0;
  let active = false;
  let hold: ReturnType<typeof setTimeout> | null = null;
  const move = (event: DomPointerEvent) => {
    event.preventDefault();
    if (active) handlers.move(event.clientY - startY);
    else if (Math.abs(event.clientY - startY) > 10 || Math.abs(event.clientX - startX) > 10) up();
  };
  const up = () => {
    if (hold !== null) {
      clearTimeout(hold);
      hold = null;
    }
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    if (active) handlers.end();
    active = false;
  };
  const down = (event: DomPointerEvent) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    startX = event.clientX;
    startY = event.clientY;
    const begin = () => {
      hold = null;
      active = true;
      handlers.start();
    };
    if (event.pointerType === "touch" && touchHoldMs > 0) hold = setTimeout(begin, touchHoldMs);
    else begin();
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  node.addEventListener("pointerdown", down);
  return () => {
    node.removeEventListener("pointerdown", down);
    up();
  };
}

/**
 * Takes a web element out of the desktop window's drag area. In the desktop app the sidebar is part of
 * that area: everything that is not a button drags the window and swallows the mouse wheel. Inline
 * `no-drag` on the element carves its whole box out, buttons inside included. (Paseo's
 * `data-window-content` marker is not usable here: it resets every descendant to `initial`, which
 * removes the buttons' own no-drag and makes the whole list a drag area.) A no-op off the web.
 */
export function excludeFromWindowDrag(node: unknown): void {
  if (Platform.OS !== "web" || typeof node !== "object" || node === null || !("style" in node)) return;
  const style = node.style;
  if (typeof style === "object" && style !== null && "setProperty" in style && typeof style.setProperty === "function") {
    style.setProperty.call(style, "-webkit-app-region", "no-drag");
  }
}

interface DomSizeEntry {
  contentRect: { width: number; height: number };
}

declare const ResizeObserver:
  | (new (callback: (entries: DomSizeEntry[]) => void) => { observe(node: unknown): void; disconnect(): void })
  | undefined;

/**
 * Calls `onChange` when a web element is hidden (no size: a background tab is `display: none`) or shown
 * again. Unlike an intersection check, an element scrolled out of a clipped bar still counts as shown.
 * Returns a cleanup; a no-op off the web.
 */
export function watchShown(node: unknown, onChange: (shown: boolean) => void): () => void {
  if (Platform.OS !== "web" || !node || typeof ResizeObserver === "undefined") return () => {};
  const observer = new ResizeObserver((entries) => {
    const rect = entries[entries.length - 1]?.contentRect;
    if (rect) onChange(rect.width > 0 && rect.height > 0);
  });
  observer.observe(node);
  return () => observer.disconnect();
}

/** Calls `handler` on a double-click of a web element. Returns a cleanup; a no-op off the web. */
export function onDoubleClick(node: unknown, handler: () => void): () => void {
  if (Platform.OS !== "web" || !isDomTarget(node)) return () => {};
  const listener = (event: DomPointerEvent) => {
    event.preventDefault();
    handler();
  };
  node.addEventListener("dblclick", listener);
  return () => node.removeEventListener("dblclick", listener);
}

interface DomKeyEvent {
  key: string;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

declare const document: {
  addEventListener(type: "keydown", listener: (event: DomKeyEvent) => void, capture: boolean): void;
  removeEventListener(type: "keydown", listener: (event: DomKeyEvent) => void, capture: boolean): void;
};

/**
 * Calls `handler` when Escape is pressed while `node` has the focus. Listens in the capture phase, ahead
 * of the app's own Escape handling, which would otherwise take the key first. A no-op off the web.
 */
export function onEscapeKey(node: unknown, handler: () => void): () => void {
  if (Platform.OS !== "web" || !node) return () => {};
  const listener = (event: DomKeyEvent) => {
    if (event.key !== "Escape" || event.target !== node) return;
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
  document.addEventListener("keydown", listener, true);
  return () => document.removeEventListener("keydown", listener, true);
}

interface DomWheelEvent {
  deltaY: number;
  /** 0 pixels, 1 lines, 2 pages. */
  deltaMode: number;
  preventDefault(): void;
  stopPropagation(): void;
}

interface DomScrollable {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
}

interface DomWheelTarget {
  addEventListener(type: "wheel", listener: (event: DomWheelEvent) => void, options: { passive: boolean; capture: boolean }): void;
  removeEventListener(type: "wheel", listener: (event: DomWheelEvent) => void, options: { capture: boolean }): void;
}

function scrollableNode(scrollView: unknown): DomScrollable | null {
  if (typeof scrollView !== "object" || scrollView === null || !("getScrollableNode" in scrollView)) return null;
  const getter = scrollView.getScrollableNode;
  const node: unknown = typeof getter === "function" ? getter.call(scrollView) : null;
  return typeof node === "object" && node !== null && "scrollTop" in node ? (node as DomScrollable) : null;
}

/**
 * Scrolls a React Native ScrollView by the mouse wheel on the web, wherever the pointer is inside `area`
 * (the whole list, its headings and gaps too, not only its buttons). Inside the app's sidebar the wheel
 * otherwise reaches the list only in some places, or after it has been clicked once. Listens in the
 * capture phase, ahead of anything inside the list. At either end the wheel is left to the page.
 * Returns a cleanup; a no-op off the web.
 */
export function attachWheelScroll(scrollView: unknown, area: unknown): () => void {
  if (Platform.OS !== "web") return () => {};
  const node = scrollableNode(scrollView);
  if (!node || typeof area !== "object" || area === null || !("addEventListener" in area)) return () => {};
  const target = area as DomWheelTarget;
  const listener = (event: DomWheelEvent) => {
    const delta = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * node.clientHeight : event.deltaY;
    const next = Math.min(Math.max(0, node.scrollTop + delta), node.scrollHeight - node.clientHeight);
    if (next === node.scrollTop) return;
    node.scrollTop = next;
    event.preventDefault();
    event.stopPropagation();
  };
  target.addEventListener("wheel", listener, { passive: false, capture: true });
  return () => target.removeEventListener("wheel", listener, { capture: true });
}
