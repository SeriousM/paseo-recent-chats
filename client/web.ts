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
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

interface DomTarget {
  addEventListener(type: string, listener: (event: DomPointerEvent) => void, capture?: boolean): void;
  removeEventListener(type: string, listener: (event: DomPointerEvent) => void, capture?: boolean): void;
}

declare const window: DomTarget;

function isDomTarget(node: unknown): node is DomTarget {
  return typeof node === "object" && node !== null && "addEventListener" in node && "removeEventListener" in node;
}

/**
 * Back and forward through visited chats from anywhere in the window: the mouse's back (button 3) and
 * forward (button 4) buttons, and Alt+← / Alt+→. Those keys are left alone in a terminal, and on a Mac in any
 * text field, where they move by word. Several lists can be on screen, and every host's copy of the plugin
 * mounts its own, so the first listener that sees an event marks it and the others leave it. The browser's
 * own navigation on those inputs is prevented. Returns a cleanup; a no-op off the web.
 */
export function onBackForward(handler: (by: -1 | 1) => void): () => void {
  if (Platform.OS !== "web" || typeof window === "undefined" || !isDomTarget(window)) return () => {};
  const once = (event: object, by: -1 | 1) => {
    const marked = event as { __recentChatsHistory?: boolean };
    if (marked.__recentChatsHistory) return;
    marked.__recentChatsHistory = true;
    handler(by);
  };
  const swallow = (event: DomPointerEvent) => {
    if (event.button === 3 || event.button === 4) event.preventDefault();
  };
  const press = (event: DomPointerEvent) => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault();
    once(event, event.button === 3 ? -1 : 1);
  };
  const key = (raw: DomPointerEvent) => {
    const event = raw as unknown as DomKeyEvent;
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (movesByWord(event.target)) return;
    event.preventDefault();
    once(event, event.key === "ArrowLeft" ? -1 : 1);
  };
  window.addEventListener("mousedown", swallow);
  window.addEventListener("mouseup", press);
  // Capture phase: a chat that opens puts the focus in its composer, whose editor takes Alt+arrows for itself
  // and stops them before they reach the window; Alt+← got through only because the focus was elsewhere.
  window.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("mousedown", swallow);
    window.removeEventListener("mouseup", press);
    window.removeEventListener("keydown", key, true);
  };
}

interface DomKeyEvent {
  key: string;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  target: unknown;
  preventDefault(): void;
  stopPropagation(): void;
}

/** Where Alt+arrow already means something: a terminal (xterm types into a helper text area), and on a Mac every text field. */
function movesByWord(target: unknown): boolean {
  const node = target as { tagName?: string; isContentEditable?: boolean; closest?(selector: string): unknown } | null;
  if (!node) return false;
  if (isTerminal(node)) return true;
  const editable = node.isContentEditable === true || node.tagName === "INPUT" || node.tagName === "TEXTAREA";
  return editable && /Mac|iPhone|iPad/.test(readUserAgent() ?? "");
}

/** Inside Paseo's terminal (xterm), whose keys are never taken. */
function isTerminal(target: unknown): boolean {
  const node = target as { closest?(selector: string): unknown } | null;
  return typeof node?.closest === "function" && node.closest(".xterm") !== null;
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

/** Calls `handler` on a right-click of a web element instead of the browser's own menu. Returns a cleanup; a no-op off the web. */
export function onContextMenu(node: unknown, handler: () => void): () => void {
  if (Platform.OS !== "web" || !isDomTarget(node)) return () => {};
  const listener = (event: DomPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
  node.addEventListener("contextmenu", listener);
  return () => node.removeEventListener("contextmenu", listener);
}

interface DomContains {
  contains(other: unknown): boolean;
}

/**
 * Calls `handler` once a pointer goes down outside `node`, or Escape is pressed: how a menu closes.
 * Returns a cleanup; a no-op off the web.
 */
export function onDismiss(node: unknown, handler: () => void): () => void {
  if (Platform.OS !== "web" || typeof node !== "object" || node === null || !("contains" in node)) return () => {};
  const inside = node as DomContains;
  const down = (event: DomPointerEvent) => {
    if (!inside.contains(event.target)) handler();
  };
  const key = (event: DomKeyEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    handler();
  };
  window.addEventListener("pointerdown", down, true);
  document.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("pointerdown", down, true);
    document.removeEventListener("keydown", key, true);
  };
}

interface DomElement {
  querySelector(selector: string): DomElement | null;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  contains(other: unknown): boolean;
  click(): void;
  parentElement: DomElement | null;
  firstElementChild: DomElement | null;
  offsetParent: unknown;
  offsetWidth: number;
  scrollTop: number;
  scrollHeight: number;
}

declare const document: {
  addEventListener(type: "keydown" | "keyup", listener: (event: DomKeyEvent) => void, capture: boolean): void;
  removeEventListener(type: "keydown" | "keyup", listener: (event: DomKeyEvent) => void, capture: boolean): void;
  querySelectorAll(selector: string): ArrayLike<DomElement>;
  activeElement: unknown;
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

/** The browser's navigator where there is one (desktop and web); undefined on phones. */
declare const navigator: { userAgent: string; clipboard?: { writeText(text: string): Promise<void> } } | undefined;

export function readUserAgent(): string | null {
  return typeof navigator === "undefined" ? null : navigator.userAgent;
}

export function clipboardWriter(): ((text: string) => Promise<void>) | null {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator?.clipboard;
  return clipboard ? (text) => clipboard.writeText(text) : null;
}

/** Paseo draws a short tick per prompt of the chat on screen (its chat outline); the active one is wider. */
const OUTLINE_RAIL = '[data-testid="chat-outline-rail"]';
const OUTLINE_TICK = '[data-testid^="chat-outline-tick-"]';
/** The nearest ancestor of `node` that also holds the chat's scroll area: the chat pane the rail belongs to. */
function chatPaneOf(node: DomElement): DomElement | null {
  for (let at = node.parentElement; at; at = at.parentElement) {
    if (at.querySelector('[data-testid="agent-chat-scroll"]')) return at;
  }
  return null;
}

/**
 * Scrolls a chat pane to its very end. Paseo's "scroll to bottom" button is not pressed: the test id sits on
 * its animated frame, not on the button inside, so a click there does nothing. The chat's scroll area is
 * moved instead, and again on the next two frames, since a virtualized list grows as it lays out its end.
 */
function scrollPaneToBottom(pane: DomElement): void {
  const scroll = pane.querySelector('[data-testid="agent-chat-scroll"]');
  if (!scroll) return;
  const end = () => {
    scroll.scrollTop = scroll.scrollHeight;
  };
  end();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => (end(), requestAnimationFrame(end)));
}

/**
 * Alt+↑ / Alt+↓ jump to the previous or next of your own messages in the chat on screen, like a press on
 * Paseo's chat outline (the ticks at the right edge). Past the newest message Alt+↓ scrolls to the bottom.
 * Plugins get no API for the chat, so this works on what Paseo draws (its test ids): web and desktop only,
 * and it does nothing once Paseo changes that. Left alone in terminals and code editors, where Alt+↑/↓ moves
 * lines, and on a Mac in text fields. The chat pane holding the focus wins; else the first one on screen.
 * Every host's copy registers it; the first listener marks the event. Returns a cleanup.
 */
export function attachPromptJumpKeys(): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined" || typeof document.querySelectorAll !== "function") return () => {};
  // The prompt the last Alt+↑/↓ went to. A prompt near the end cannot scroll up to the top of the chat, so
  // Paseo keeps the one before it active; without this the next Alt+↓ would go to that same prompt again.
  const memo = ((globalThis as Record<string, unknown>)["__paseoRecentChats.promptJump.v1"] ??= { rail: null, index: -1 }) as {
    rail: DomElement | null;
    index: number;
  };
  const key = (event: DomKeyEvent) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown" && event.key !== "End") return;
    const target = event.target as { closest?(selector: string): unknown } | null;
    if (movesByWord(event.target) || target?.closest?.(".cm-editor")) return;
    const marked = event as DomKeyEvent & { __recentChatsPrompt?: boolean };
    if (marked.__recentChatsPrompt) return;
    const rails = Array.from(document.querySelectorAll(OUTLINE_RAIL)).filter((rail) => rail.offsetParent !== null);
    const panes = rails.map((rail) => ({ rail, pane: chatPaneOf(rail) }));
    const chosen = panes.find(({ pane }) => pane?.contains(document.activeElement)) ?? panes[0];
    const scrolls = Array.from(document.querySelectorAll('[data-testid="agent-chat-scroll"]')).filter((el) => el.offsetParent !== null);
    const focusedPane = scrolls.find((el) => el.parentElement?.contains(document.activeElement))?.parentElement ?? scrolls[0]?.parentElement;
    const pane = chosen?.pane ?? focusedPane ?? null;
    if (!pane) return;
    marked.__recentChatsPrompt = true;
    event.preventDefault();
    event.stopPropagation();
    // Alt+End: straight to the end of the chat.
    if (event.key === "End") {
      scrollPaneToBottom(pane);
      return;
    }
    const down = event.key === "ArrowDown";
    if (!chosen) {
      // Fewer than two prompts, or the pane is too narrow for the outline: only "to the bottom" is left.
      if (down) scrollPaneToBottom(pane);
      return;
    }
    const ticks = Array.from(chosen.rail.querySelectorAll(OUTLINE_TICK));
    // An inactive tick's pill is 10 px wide and the active one's 18, so the widest pill marks the active prompt.
    const widths = ticks.map((tick) => tick.firstElementChild?.offsetWidth ?? 0);
    const widest = Math.max(...widths);
    const active = widest > Math.min(...widths) ? widths.indexOf(widest) : ticks.length - 1;
    const current = memo.rail === chosen.rail && memo.index - 1 === active ? memo.index : active;
    const next = current + (down ? 1 : -1);
    if (next >= ticks.length) {
      memo.index = -1;
      scrollPaneToBottom(chosen.pane ?? pane);
      return;
    }
    const index = Math.max(0, next);
    memo.rail = chosen.rail;
    memo.index = index;
    ticks[index]?.click();
  };
  document.addEventListener("keydown", key, true);
  return () => document.removeEventListener("keydown", key, true);
}

/**
 * Something done in the chat on screen: a click into its messages, or typing in a text field (the composer)
 * other than Alt, Ctrl or Cmd shortcuts. Every host's copy registers it; the first listener marks the event.
 * Returns a cleanup; a no-op off the web.
 */
export function onChatInteraction(handler: () => void): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined" || !isDomTarget(window)) return () => {};
  const once = (event: object) => {
    const marked = event as { __recentChatsInteraction?: boolean };
    if (marked.__recentChatsInteraction) return;
    marked.__recentChatsInteraction = true;
    handler();
  };
  const pointer = (event: DomPointerEvent) => {
    const target = event.target as { closest?(selector: string): unknown } | null;
    if (target?.closest?.('[data-testid="agent-chat-scroll"]')) once(event);
  };
  const key = (event: DomKeyEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const node = event.target as { tagName?: string; isContentEditable?: boolean; className?: unknown } | null;
    if (!node || isTerminal(node)) return;
    const editable = node.isContentEditable === true || node.tagName === "INPUT" || node.tagName === "TEXTAREA";
    if (editable && (event.key.length === 1 || event.key === "Enter" || event.key === "Backspace")) once(event);
  };
  window.addEventListener("pointerdown", pointer, true);
  document.addEventListener("keydown", key, true);
  return () => {
    window.removeEventListener("pointerdown", pointer, true);
    document.removeEventListener("keydown", key, true);
  };
}

/**
 * Alt (with `shift`, Alt+Shift) plus the key with `code` ("KeyL"), from anywhere in the window except a terminal and, on a Mac, a text
 * field (where Option types a character). `handler` returns whether it used the key; then the event is taken.
 * Every host's copy registers it; the first listener that uses the event marks it. A no-op off the web.
 */
export function onAltKey(code: string, handler: () => boolean, shift = false): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined") return () => {};
  const key = (event: DomKeyEvent) => {
    const keyed = event as DomKeyEvent & { code?: string; __recentChatsAltKey?: boolean };
    if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey !== shift || keyed.code !== code) return;
    if (keyed.__recentChatsAltKey || movesByWord(event.target)) return;
    if (!handler()) return;
    keyed.__recentChatsAltKey = true;
    event.preventDefault();
    event.stopPropagation();
  };
  document.addEventListener("keydown", key, true);
  return () => document.removeEventListener("keydown", key, true);
}

/**
 * Calls `handler(true)` while Alt and Shift are both held with nothing else, and `handler(false)` once either
 * is let go, another key joins, or the window loses focus. Only watches: no key is taken. A no-op off the web.
 */
export function onAltShiftHeld(handler: (held: boolean) => void): () => void {
  if (Platform.OS !== "web" || typeof document === "undefined" || !isDomTarget(window)) return () => {};
  const down = (event: DomKeyEvent) => {
    const modifierOnly = event.key === "Alt" || event.key === "Shift";
    handler(event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (modifierOnly || /^Digit[1-9]$/.test((event as DomKeyEvent & { code?: string }).code ?? "")));
  };
  const up = (event: DomKeyEvent) => {
    if (!event.altKey || !event.shiftKey) handler(false);
  };
  const blur = () => handler(false);
  document.addEventListener("keydown", down, true);
  document.addEventListener("keyup", up, true);
  window.addEventListener("blur", blur as never);
  return () => {
    document.removeEventListener("keydown", down, true);
    document.removeEventListener("keyup", up, true);
    window.removeEventListener("blur", blur as never);
  };
}
