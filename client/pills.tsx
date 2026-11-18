import type {
  PluginButton,
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import type { PaseoAgentListResult } from "./paseo-types";
import { getStore } from "./runtime";
import { HostFilter, isDark, ledColor, TriageList } from "./triage-list";
import { hostColors } from "./format";
import { buildTriage, chatKey, nextUp, type TriageResult } from "./triage";
import { limitsOf, openChat, useRecents } from "./use-recents";
import { reportOpenChat } from "./open-chat";
import { watchShown } from "./web";
import { RECENT_SCREEN_ID } from "./sidebar-item";
import { HistoryButtons } from "./recent-panel";
import { PILL_IDS, pillsInOrder, type PillId } from "../shared/settings";
import { useTouchInput } from "./input";

const PILL_PAGE_SIZE = 200;
const PILL_MAX_PAGES = 25;

// Host that owns this installation's pills, learned from the first pill icon that renders.
let pillHostId: string | null = null;

function inboxLabel(result: TriageResult): string {
  const parts: string[] = [];
  if (result.counts.unread) parts.push(String(result.counts.unread));
  if (result.counts.running) parts.push(`${result.counts.running}\u25B6`);
  return parts.length ? `Inbox ${parts.join(" \u00B7 ")}` : "Inbox";
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

function LaterIcon(props: PluginButtonIconProps) {
  useRecents();
  const node = useShownChat(props);
  return (
    <View ref={node}>
      <Icon name="Clock" size={props.size} color={props.theme.colors.foregroundMuted} />
    </View>
  );
}

/** The chat's host (the host whose copy registered the pill) in the colour set for it in Paseo. */
function HostIcon(props: PluginButtonIconProps) {
  const { snapshot } = useRecents();
  const tint = hostColors(snapshot.hostColors[props.host.id], isDark(props.theme.colors.surface0));
  return <Icon name="Server" size={props.size} color={tint?.text ?? props.theme.colors.foregroundMuted} />;
}

function createInboxContent(client: PluginClientContext) {
  return function InboxContent(props: PluginButtonContentProps) {
    const { theme, layout, close } = props;
    const { store, snapshot, result } = useRecents();
    const target = { openScreen: (input: { screenId: string; params?: Record<string, string> }) => client.openScreen(input) };
    const [hostsOpen, setHostsOpen] = useState(false);
    const touch = useTouchInput();
    const manyHosts = snapshot.hosts.length >= 2;
    const tone = hostsOpen ? theme.colors.foreground : theme.colors.foregroundMuted;
    return (
      <View>
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
  const registered = new Map<string, { workspaceId: string; pills: Map<PillId, PluginButtonRegistration> }>();
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

  async function later(agentId: string): Promise<void> {
    if (!pillHostId) return;
    const key = chatKey(pillHostId, agentId);
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

  function button(pill: PillId, agentId: string): PluginButton {
    switch (pill) {
      case "inbox":
        return {
          title: "Recent Chats inbox",
          icon: InboxIcon,
          label: lastLabel,
          visible: lastVisible.inbox,
          behavior: { kind: "popover", Content: InboxContent },
        };
      case "later":
        return {
          title: "Mark this chat unread and open the next one",
          icon: LaterIcon,
          label: "Later",
          visible: lastVisible.later,
          behavior: { kind: "action", onPress: () => later(agentId) },
        };
      case "host":
        return {
          title: "The host this chat runs on",
          icon: HostIcon,
          label: lastHostLabel,
          visible: lastVisible.host,
          behavior: { kind: "action", onPress: () => client.openScreen({ screenId: RECENT_SCREEN_ID }) },
        };
    }
  }

  function addPills(agentId: string, workspaceId: string) {
    const pills = new Map<PillId, PluginButtonRegistration>();
    for (const pill of lastOrder) pills.set(pill, client.addComposerPill({ id: pill, workspaceId, agentId, button: button(pill, agentId) }));
    registered.set(agentId, { workspaceId, pills });
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
    if (!reorder && !changed) return;
    lastLabel = label;
    lastVisible = visible;
    lastOrder = order;
    lastHostLabel = host;
    for (const [agentId, entry] of [...registered]) {
      if (reorder) {
        unregister(agentId);
        addPills(agentId, entry.workspaceId);
        continue;
      }
      entry.pills.get("inbox")?.update({ label, visible: visible.inbox });
      entry.pills.get("later")?.update({ visible: visible.later });
      entry.pills.get("host")?.update({ label: host, visible: visible.host });
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
    for (const id of [...registered.keys()]) unregister(id);
    void release?.().catch(() => {});
  };
}
