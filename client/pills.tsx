import type {
  PluginButtonContentProps,
  PluginButtonIconProps,
  PluginButtonRegistration,
  PluginClientContext,
} from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useEffect, useRef } from "react";
import { View } from "react-native";
import type { PaseoAgentListResult } from "./paseo-types";
import { getStore } from "./runtime";
import { ledColor, TriageList } from "./triage-list";
import { buildTriage, chatKey, nextUp, type TriageResult } from "./triage";
import { limitsOf, openChat, useRecents } from "./use-recents";
import { reportOpenChat } from "./open-chat";
import { watchShown } from "./web";
import { RECENT_SCREEN_ID } from "./sidebar-item";

const INBOX_PILL_ID = "inbox";
const LATER_PILL_ID = "later";
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

function createInboxContent(client: PluginClientContext) {
  return function InboxContent(props: PluginButtonContentProps) {
    const { theme, layout, close } = props;
    const { store, snapshot, result } = useRecents();
    return (
      <TriageList
        theme={theme}
        compact={layout.compact}
        result={result}
        snapshot={snapshot}
        onToggleHost={store.toggleHost}
        onToggleGroupByHost={() => store.updatePrefs({ groupByHost: !snapshot.prefs.groupByHost })}
        onToggleSort={store.toggleSort}
        onOpen={(row) => {
          close();
          openChat(store, row, { openScreen: (input) => client.openScreen(input) });
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
    );
  };
}

/** Registers the inbox and Later pills on every chat of the selected host and keeps them current. */
export function registerPills(client: PluginClientContext): () => void {
  const store = getStore();
  const lifetime = new AbortController();
  const InboxContent = createInboxContent(client);
  const registered = new Map<
    string,
    { workspaceId: string; inbox: PluginButtonRegistration; later: PluginButtonRegistration }
  >();
  let lastLabel = "Inbox";
  let lastInboxVisible = true;
  let lastLaterVisible = true;
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

  function register(agent: { id: string; workspaceId?: string | null }) {
    if (lifetime.signal.aborted || !agent.workspaceId) return;
    const existing = registered.get(agent.id);
    if (existing?.workspaceId === agent.workspaceId) return;
    existing?.inbox.remove();
    existing?.later.remove();
    const workspaceId = agent.workspaceId;
    const agentId = agent.id;
    registered.set(agentId, {
      workspaceId,
      inbox: client.addComposerPill({
        id: INBOX_PILL_ID,
        workspaceId,
        agentId,
        button: {
          title: "Recent Chats inbox",
          icon: InboxIcon,
          label: lastLabel,
          visible: lastInboxVisible,
          behavior: { kind: "popover", Content: InboxContent },
        },
      }),
      later: client.addComposerPill({
        id: LATER_PILL_ID,
        workspaceId,
        agentId,
        button: {
          title: "Mark this chat unread and open the next one",
          icon: LaterIcon,
          label: "Later",
          visible: lastLaterVisible,
          behavior: { kind: "action", onPress: () => later(agentId) },
        },
      }),
    });
  }

  function unregister(agentId: string) {
    const entry = registered.get(agentId);
    entry?.inbox.remove();
    entry?.later.remove();
    registered.delete(agentId);
  }

  const unsubscribe = store.subscribe(() => {
    const snapshot = store.getSnapshot();
    const label = inboxLabel(buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now()));
    const inboxVisible = snapshot.prefs.showInboxPill;
    const laterVisible = snapshot.prefs.showLaterPill;
    if (label === lastLabel && inboxVisible === lastInboxVisible && laterVisible === lastLaterVisible) return;
    lastLabel = label;
    lastInboxVisible = inboxVisible;
    lastLaterVisible = laterVisible;
    for (const entry of registered.values()) {
      entry.inbox.update({ label, visible: inboxVisible });
      entry.later.update({ visible: laterVisible });
    }
  });

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
