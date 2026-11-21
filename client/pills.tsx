import type {
  PluginButton,
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { Pressable, View } from "react-native";
import type { PaseoAgentListResult } from "./paseo-types";
import { getStore } from "./runtime";
import { HostFilter, isDark, ledColor, TriageList } from "./triage-list";
import { hostColors } from "./format";
import { buildTriage, chatKey, nextUp, type TriageResult } from "./triage";
import { limitsOf, openChat, openChatByKey, useRecents, type OpenTarget } from "./use-recents";
import { directOpener } from "./navigation";
import { moveInHistory } from "./chat-history";
import { currentOpenChat, reportOpenChat } from "./open-chat";
import { hideStrayPopup, jumpPrompt, onAltKey, onAltShiftHeld, onBackForward, onListKeys, pressComposerPill, watchShown } from "./web";
import { isLater } from "./overlay";
import { browsedChat, endBrowsing } from "./browse";
import { currentLinger } from "./linger";
import { numberedChats, setNumbersShown } from "./numbered";
import { RECENT_SCREEN_ID } from "./sidebar-item";
import { HistoryButtons } from "./recent-panel";
import { PILL_IDS, pillsInOrder, type PillId } from "../shared/settings";
import { useTouchInput } from "./input";
import { trace } from "./trace";

/** The Inbox pill's title, which is also how Alt+I finds it on screen. */
const INBOX_TITLE = "Recent Chats inbox";
const PILL_PAGE_SIZE = 200;
const PILL_MAX_PAGES = 25;

// Host that owns this installation's pills, learned from the first pill icon that renders.
let pillHostId: string | null = null;

/** "3 waiting · 1▶": the chats that wait for you, then the running ones; "Inbox" when there are none. */
function inboxLabel(result: TriageResult): string {
  const parts: string[] = [];
  if (result.counts.unread) parts.push(`${result.counts.unread} waiting`);
  if (result.counts.running) parts.push(`${result.counts.running}\u25B6`);
  return parts.length ? parts.join(" \u00B7 ") : "Inbox";
}

/**
 * Remembers the host for Later, and reports the icon's chat as the open one while it is shown. Returns
 * the ref for the icon's wrapper, whose size tells (on the web) whether the chat's tab is on screen.
 */
function useShownChat(props: PluginButtonIconProps) {
  const agentId = props.context === "agent" ? props.agentId : null;
  const hostId = props.host.id;
  const node = useRef<View>(null);
  useEffect(() => {
    pillHostId = hostId;
    if (!agentId) return undefined;
    const shown = reportOpenChat(chatKey(hostId, agentId));
    const stopWatching = watchShown(node.current, shown.setVisible);
    return () => {
      stopWatching();
      shown.remove();
    };
  }, [hostId, agentId]);
  return node;
}

function InboxIcon(props: PluginButtonIconProps) {
  const { theme, size } = props;
  const { result } = useRecents();
  const node = useShownChat(props);
  const color = result.worstUnread
    ? ledColor(theme, result.worstUnread)
    : result.counts.running
      ? ledColor(theme, "running")
      : theme.colors.foregroundMuted;
  return (
    <View ref={node}>
      <Icon name="Inbox" size={size} color={color} />
    </View>
  );
}

/**
 * The pin state of the chat: an accent pin while it is pinned, a struck-through grey pin while it is not. Paseo
 * gives a pill's icon room for one icon only, so what a press does is in the label ("Later" or "Read").
 */
function LaterIcon(props: PluginButtonIconProps) {
  const { snapshot } = useRecents();
  const node = useShownChat(props);
  const key = props.context === "agent" ? chatKey(props.host.id, props.agentId) : null;
  const pinned = key !== null && snapshot.overlay[key]?.pinnedAt !== undefined;
  return (
    <View ref={node}>
      <Icon name={pinned ? "Pin" : "PinOff"} size={props.size} color={pinned ? props.theme.colors.accent : props.theme.colors.foregroundMuted} />
    </View>
  );
}

/** The chat's host (the host whose copy registered the pill) in the colour set for it in Paseo. */
function HostIcon(props: PluginButtonIconProps) {
  const { snapshot } = useRecents();
  const tint = hostColors(snapshot.hostColors[props.host.id], isDark(props.theme.colors.surface0));
  return <Icon name="Server" size={props.size} color={tint?.text ?? props.theme.colors.foregroundMuted} />;
}

/**
 * The chat whose title field the next Inbox popup opens with (Alt+R), for a second. Read, not taken: Paseo can
 * draw the popup more than once (a stray copy, see hideStrayPopup), and every copy has to see it. Shared on
 * globalThis: the copy of the plugin that takes Alt+R is often not the one of the chat's host, whose pill
 * opens the popup. The shape is a contract between plugin versions: change it together with the key.
 */
interface RenameRequest {
  pending: { key: string; at: number; id: number } | null;
  listeners: Set<() => void>;
}
const renameShared = (): RenameRequest =>
  ((globalThis as Record<string, unknown>)["__paseoRecentChats.renameRequest.v1"] ??= { pending: null, listeners: new Set() }) as RenameRequest;
function requestRename(key: string | null): void {
  const shared = renameShared();
  shared.pending = key ? { key, at: Date.now(), id: (shared.pending?.id ?? 0) + 1 } : null;
  for (const listener of [...shared.listeners]) listener();
}
/**
 * The rename asked for within the last second, live: Paseo keeps the popup's content mounted between
 * openings, so it has to follow each new request, not only the one present when it first appeared.
 */
function usePendingRename(): { key: string; id: number } | null {
  const current = useSyncExternalStore(
    (listener) => {
      const { listeners } = renameShared();
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    () => renameShared().pending,
  );
  return current && Date.now() - current.at < 1000 ? current : null;
}

function createInboxContent(client: PluginClientContext) {
  return function InboxContent(props: PluginButtonContentProps) {
    const { theme, layout, close } = props;
    const { store, snapshot, result } = useRecents();
    // Alt+R: this chat's title field opens at once (when the chat is listed).
    const rename = usePendingRename();
    const target = { openScreen: (input: { screenId: string; params?: Record<string, string> }) => client.openScreen(input) };
    const [hostsOpen, setHostsOpen] = useState(false);
    const touch = useTouchInput();
    const manyHosts = snapshot.hosts.length >= 2;
    const tone = hostsOpen ? theme.colors.foreground : theme.colors.foregroundMuted;
    // ↑ ↓ choose a row, Enter opens it (Alt+I opens this popup from the keyboard). The choice starts on the
    // chat this popup belongs to when it is listed, else on the first row.
    const [visible, setVisible] = useState<readonly string[]>([]);
    const [chosen, setChosen] = useState<string | null>(null);
    const own = props.context === "agent" ? chatKey(props.host.id, props.agentId) : null;
    const selected =
      chosen !== null && visible.includes(chosen) ? chosen : own !== null && visible.includes(own) ? own : (visible[0] ?? null);
    const keys = useRef({ visible, selected, result });
    keys.current = { visible, selected, result };
    const root = useRef<View>(null);
    // A stray copy of this popup (from a hidden copy of the composer) is hidden and ignores the keys.
    const stray = useRef(false);
    // Before the first paint, so the stray copy is never seen.
    useLayoutEffect(() => hideStrayPopup(root.current, (value) => (stray.current = value)), []);
    useEffect(() => {
      if (!rename) return;
      const dom = root.current as unknown as { offsetParent?: unknown; offsetHeight?: number } | null;
      trace("inbox.rename", {
        key: rename.key,
        id: rename.id,
        stray: stray.current,
        onScreen: dom?.offsetParent !== null && dom?.offsetParent !== undefined,
        height: dom?.offsetHeight,
        own,
        inAll: result.all.some((row) => row.key === rename.key),
        inRows: result.rows.some((row) => row.key === rename.key),
        rows: result.rows.length,
      });
    }, [rename?.id]);
    useEffect(
      () =>
        onListKeys((key) => {
          const { visible: list, selected: current, result: latest } = keys.current;
          // Only while this popup is on screen: the app may keep it mounted after it closes.
          if (stray.current || list.length === 0 || (root.current as unknown as { offsetParent?: unknown } | null)?.offsetParent === null) return false;
          if (key === "enter") {
            const row = latest.all.find((candidate) => candidate.key === current);
            if (!row) return false;
            close();
            openChat(store, row, target);
            return true;
          }
          const at = current === null ? -1 : list.indexOf(current);
          // Page Up / Page Down move by five rows; Home and End to the first and last.
          const step = { up: -1, down: 1, pageUp: -5, pageDown: 5, home: -list.length, end: list.length }[key];
          const next = Math.max(0, Math.min(list.length - 1, (at < 0 ? 0 : at) + step));
          setChosen(list[next] ?? null);
          return true;
        }),
      [close, store],
    );
    return (
      <View ref={root}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, paddingHorizontal: 6, paddingTop: 4 }}>
          {manyHosts ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Hosts: which hosts are listed, and grouping by host"
              accessibilityState={{ expanded: hostsOpen }}
              onPress={() => setHostsOpen(!hostsOpen)}
              hitSlop={4}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 6,
                minHeight: touch ? 36 : 24,
                borderRadius: 7,
                borderWidth: 1,
                borderColor: hostsOpen ? theme.colors.border : "transparent",
                backgroundColor: hostsOpen ? theme.colors.surface2 : "transparent",
              }}
            >
              <Icon name="Server" size={13} color={tone} />
              <Icon name={hostsOpen ? "ChevronUp" : "ChevronDown"} size={11} color={tone} />
            </Pressable>
          ) : null}
          <View style={{ flex: 1 }} />
          <HistoryButtons theme={theme} target={target} onNavigate={close} />
        </View>
        {manyHosts && hostsOpen ? (
          <HostFilter
            theme={theme}
            compact={touch}
            hosts={snapshot.hosts}
            hostColors={snapshot.hostColors}
            onToggle={store.toggleHost}
            groupByHost={snapshot.prefs.groupByHost}
            onToggleGroupByHost={() => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })}
          />
        ) : null}
        <TriageList
          hideHostFilter
          theme={theme}
          compact={touch}
          narrow={layout.compact}
          result={result}
          snapshot={snapshot}
          onToggleHost={store.toggleHost}
          onToggleGroupByHost={() => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })}
          onToggleSort={store.toggleSort}
          onOpen={(row) => {
            close();
            openChat(store, row, target);
          }}
          onMarkRead={store.markRead}
          onMarkUnread={store.markUnread}
          onSetPinned={store.setPinned}
          onRename={store.renameChat}
          footer="first"
          showSettingsButton
          selectedKey={selected}
          rename={rename}
          onVisibleRows={setVisible}
          onShowAll={() => {
            close();
            client.openScreen({ screenId: RECENT_SCREEN_ID });
          }}
        />
      </View>
    );
  };
}

/** Registers the inbox and Later pills on every chat of the selected host and keeps them current. */
export function registerPills(client: PluginClientContext): () => void {
  const store = getStore();
  const lifetime = new AbortController();
  const InboxContent = createInboxContent(client);
  // Per chat: its workspace and its pills. Paseo shows a chat's pills in the order they were added, so they
  // are added in the order chosen in the settings, and added again when that order changes.
  const registered = new Map<string, { workspaceId: string; pills: Map<PillId, PluginButtonRegistration>; laterLabel: string }>();
  let lastLabel = "Inbox";
  let lastVisible: Record<PillId, boolean> = { inbox: true, later: true, host: false };
  let lastOrder: PillId[] = [...PILL_IDS];
  // This copy's host: every chat that gets these pills runs on it. Its label names the host pill.
  let selfId: string | null = null;
  let lastHostLabel = "Host";
  const hostLabel = () => store.getSnapshot().hosts.find((host) => host.id === selfId)?.label ?? "Host";
  void client.paseo.hosts
    .list()
    .then(({ self }) => {
      selfId = self.serverId;
      refresh();
    })
    .catch(() => {});
  let release: (() => Promise<void>) | null = null;

  /** The Later pill's text for a chat of this host: its state, "Read", or "Unread" while it is kept unread. */
  function laterLabel(agentId: string): string {
    const host = selfId ?? pillHostId;
    return host && isLater(store.getSnapshot().overlay, chatKey(host, agentId)) ? "\u{1F552} Unread" : "\u2713 Read";
  }

  /**
   * Read or Later for a chat. Kept unread (set aside with Later, or opened and not yet acted in): marks it read,
   * which counts as acting in it. Otherwise: marks it unread, then opens the next chat when "After Later" says so.
   */
  function toggleLater(key: string): void {
    if (isLater(store.getSnapshot().overlay, key)) {
      if (key === browsedChat()) endBrowsing();
      store.markRead([key]);
      return;
    }
    store.markUnread(key);
    const snapshot = store.getSnapshot();
    if (snapshot.prefs.laterBehavior !== "jump") return;
    // Same view as the lists: grouped by host the top of the list is the first host's.
    const next = nextUp(
      buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now(), {
        groupByHost: snapshot.prefs.groupByHost,
        hostOrder: snapshot.hosts.map((host) => host.id),
        sectionOrder: snapshot.prefs.sectionOrder,
        sectionSort: snapshot.prefs.sectionSort,
      }),
      key,
    );
    if (next) openChat(store, next, { openScreen: (input) => client.openScreen(input) });
  }

  // Alt+L does the same for the chat open on screen (desktop and web).
  const stopAltL = onAltKey("KeyL", () => {
    const key = currentOpenChat();
    if (!key) return false;
    toggleLater(key);
    return true;
  });

  // Alt+I opens (or closes) the Inbox pill's list of the chat on screen.
  const stopAltI = onAltKey("KeyI", () => pressComposerPill(INBOX_TITLE));

  // Alt+R renames the chat on screen: the Inbox popup opens with that chat's title field.
  const stopAltR = onAltKey("KeyR", () => {
    const key = currentOpenChat();
    if (!key) {
      trace("altR.noOpenChat");
      return false;
    }
    requestRename(key);
    const pressed = pressComposerPill(INBOX_TITLE);
    trace("altR", { key, pillPressed: pressed });
    if (pressed) return true;
    requestRename(null);
    return false;
  });

  // Keys open chats the way Paseo does when the sidebar view offers it, else through the go screen.
  const keyTarget = (): OpenTarget => {
    const open = directOpener();
    return open ? { navigation: { openAgent: open } } : { openScreen: (input) => client.openScreen(input) };
  };

  // The mouse's back and forward buttons and Alt+← / Alt+→ step through the visited chats, whatever is on screen
  // (also in focus mode, with the sidebar hidden).
  const stopBackForward = onBackForward((by) => {
    const key = moveInHistory(by, store.isChatGone);
    trace("history.step", { by, key });
    if (!key) return;
    const snapshot = store.getSnapshot();
    const rows = buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now(), { linger: currentLinger() }).all;
    openChatByKey(store, rows, key, keyTarget());
  });

  // Alt+P pins the chat on screen, or unpins it.
  const stopAltP = onAltKey("KeyP", () => {
    const key = currentOpenChat();
    if (!key) return false;
    store.setPinned(key, store.getSnapshot().overlay[key]?.pinnedAt === undefined);
    return true;
  });

  // Alt+F focuses on the host of the chat on screen (every other host switched off in the host filter), and
  // back to all hosts. Any host already switched off counts as focused: the next press shows them all.
  const stopAltF = onAltKey("KeyF", () => {
    const snapshot = store.getSnapshot();
    if (snapshot.prefs.hiddenHosts.length > 0) {
      store.updatePrefs({ hiddenHosts: [] });
      return true;
    }
    const key = currentOpenChat();
    if (!key || snapshot.hosts.length < 2) return false;
    const hostId = key.slice(0, key.indexOf(":"));
    store.updatePrefs({ hiddenHosts: snapshot.hosts.map((host) => host.id).filter((id) => id !== hostId) });
    return true;
  });

  // Alt+Shift+1 … 9 open the first to ninth chat of Needs you as the list on screen numbers them; the numbers
  // show while Alt+Shift is held. Alt+1 … 9 and Ctrl+1 … 9 are Paseo's (tabs and workspaces), which takes them
  // before a plugin sees them.
  const stopAltDigits = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((number) =>
    onAltKey(
      `Digit${number}`,
      () => {
        const key = numberedChats()[number - 1];
        if (!key) return false;
        const snapshot = store.getSnapshot();
        const row = buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now(), {
          linger: currentLinger(),
        }).all.find((candidate) => candidate.key === key);
        if (!row) return false;
        openChat(store, row, keyTarget());
        return true;
      },
      true,
    ),
  );
  const stopNumbersShown = onAltShiftHeld(setNumbersShown);

  function button(pill: PillId, agentId: string): PluginButton {
    switch (pill) {
      case "inbox":
        return {
          title: INBOX_TITLE,
          icon: InboxIcon,
          label: lastLabel,
          visible: lastVisible.inbox,
          behavior: { kind: "popover", Content: InboxContent },
        };
      case "later":
        return {
          title: "Whether this chat is read or unread. Press (or Alt+L) to switch: unread keeps it in Needs you for later",
          icon: LaterIcon,
          label: laterLabel(agentId),
          visible: lastVisible.later,
          behavior: { kind: "action", onPress: () => toggleLater(chatKey(selfId ?? pillHostId ?? "", agentId)) },
        };
      case "host":
        return {
          title: "The host this chat runs on. Press (or Alt+\u2191) to jump to your previous message in this chat",
          icon: HostIcon,
          label: lastHostLabel,
          visible: lastVisible.host,
          behavior: { kind: "action", onPress: () => void jumpPrompt("ArrowUp") },
        };
    }
  }

  function addPills(agentId: string, workspaceId: string) {
    const pills = new Map<PillId, PluginButtonRegistration>();
    for (const pill of lastOrder) pills.set(pill, client.addComposerPill({ id: pill, workspaceId, agentId, button: button(pill, agentId) }));
    registered.set(agentId, { workspaceId, pills, laterLabel: laterLabel(agentId) });
  }

  function register(agent: { id: string; workspaceId?: string | null }) {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    const existing = registered.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    unregister(agent.id);
    addPills(agent.id, agent.workspaceId);
  }

  function unregister(agentId: string) {
    for (const pill of registered.get(agentId)?.pills.values() ?? []) pill.remove();
    registered.delete(agentId);
  }

  function refresh() {
    const snapshot = store.getSnapshot();
    const label = inboxLabel(buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now()));
    const visible = { inbox: snapshot.prefs.showInboxPill, later: snapshot.prefs.showLaterPill, host: snapshot.prefs.showHostPill };
    const order = pillsInOrder(snapshot.prefs.pillOrder);
    const host = hostLabel();
    const reorder = order.join() !== lastOrder.join();
    const changed =
      label !== lastLabel || host !== lastHostLabel || PILL_IDS.some((pill) => visible[pill] !== lastVisible[pill]);
    if (reorder || changed) {
      lastLabel = label;
      lastVisible = visible;
      lastOrder = order;
      lastHostLabel = host;
    }
    for (const [agentId, entry] of [...registered]) {
      if (reorder) {
        unregister(agentId);
        addPills(agentId, entry.workspaceId);
        continue;
      }
      if (changed) {
        entry.pills.get("inbox")?.update({ label, visible: visible.inbox });
        entry.pills.get("later")?.update({ visible: visible.later });
        entry.pills.get("host")?.update({ label: host, visible: visible.host });
      }
      // Each chat's Later pill says whether that chat is marked Later.
      const later = laterLabel(agentId);
      if (later !== entry.laterLabel) {
        entry.laterLabel = later;
        entry.pills.get("later")?.update({ label: later });
      }
    }
  }
  const unsubscribe = store.subscribe(refresh);

  const directory = { filter: { includeArchived: false }, sort: [{ key: "updated_at" as const, direction: "desc" as const }] };

  /** Every chat of the host, page after page, so older chats get their pills too. */
  async function allAgents(first: PaseoAgentListResult) {
    const agents = first.entries.map(({ agent }) => agent);
    let page = first;
    const seen = new Set<string>();
    for (let count = 1; page.pageInfo.hasMore && count < PILL_MAX_PAGES; count++) {
      const cursor = page.pageInfo.nextCursor;
      if (!cursor || seen.has(cursor)) break;
      seen.add(cursor);
      page = await client.paseo.agents.list({ ...directory, page: { limit: PILL_PAGE_SIZE, cursor }, signal: lifetime.signal });
      agents.push(...page.entries.map(({ agent }) => agent));
    }
    return agents;
  }

  let generation = 0;
  client.paseo.agents
    .list({ ...directory, page: { limit: PILL_PAGE_SIZE }, subscribe: {}, signal: lifetime.signal })
    .then(({ subscription }) => {
      release = () => subscription.release();
      if (lifetime.signal.aborted) return release();
      subscription.subscribe({
        snapshot: (first) => {
          const current = ++generation;
          void allAgents(first)
            .then((agents) => {
              if (lifetime.signal.aborted || current !== generation) return;
              const present = new Set(agents.map((agent) => agent.id));
              for (const id of [...registered.keys()]) if (!present.has(id)) unregister(id);
              for (const agent of agents) register(agent);
            })
            .catch((error) => {
              if (!lifetime.signal.aborted) console.error("Recent Chats: listing chats for pills failed", error);
            });
        },
        update: (message) => {
          if (message.type !== "agent_update") return;
          const update = message.payload;
          if (update.kind === "upsert" && !update.agent.archivedAt) register(update.agent);
          else unregister(update.kind === "remove" ? update.agentId : update.agent.id);
        },
      });
    })
    .catch((error) => {
      if (!lifetime.signal.aborted) console.error("Recent Chats: pill observation failed", error);
    });

  return () => {
    lifetime.abort();
    pillHostId = null;
    unsubscribe();
    stopAltL();
    stopAltI();
    stopAltR();
    stopAltP();
    stopAltF();
    stopBackForward();
    for (const stop of stopAltDigits) stop();
    stopNumbersShown();
    setNumbersShown(false);
    for (const id of [...registered.keys()]) unregister(id);
    void release?.().catch(() => {});
  };
}
