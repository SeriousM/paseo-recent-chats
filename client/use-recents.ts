import { useHosts } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getStore } from "./runtime";
import type { RecentsStore, StoreSnapshot } from "./store";
import { buildTriage, type TriageLimits, type TriageResult, type TriageRow } from "./triage";
import { followOpenChat, holdOpened, useLinger } from "./linger";
import { useOpenChat } from "./open-chat";
import type { Prefs } from "../shared/settings";
import { recordOpenChat } from "./chat-history";

export const GO_SCREEN_ID = "go";

export interface Recents {
  store: RecentsStore;
  snapshot: StoreSnapshot;
  result: TriageResult;
}

export function limitsOf(prefs: Prefs): TriageLimits {
  return {
    maxUnread: prefs.maxUnread,
    maxRunning: prefs.maxRunning,
    maxInactive: prefs.maxInactive,
    inactiveWindowDays: prefs.inactiveWindowDays,
    unreadExpiryDays: prefs.unreadExpiryDays,
  };
}

/** Subscribes the calling surface to the shared store and keeps the store's host list current. */
export function useRecents(): Recents {
  const store = getStore();
  const hosts = useHosts();
  useEffect(() => store.setHosts(hosts), [store, hosts]);
  useEffect(() => store.retain(), [store]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const linger = useLinger();
  const openKey = useOpenChat();
  useEffect(() => {
    followOpenChat(openKey);
    if (openKey) recordOpenChat(openKey);
  }, [openKey]);
  const result = useMemo(
    () =>
      buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now(), {
        groupByHost: snapshot.prefs.groupByHost,
        hostOrder: snapshot.hosts.map((host) => host.id),
        sectionOrder: snapshot.prefs.sectionOrder,
        sectionSort: snapshot.prefs.sectionSort,
        linger,
      }),
    [snapshot, linger],
  );
  return { store, snapshot, result };
}

/** Where a surface can navigate: screens and panels have `navigation`, the rest go through the `go` screen. */
export interface OpenTarget {
  navigation?: {
    readonly openAgent: (input: { readonly agentId: string; readonly serverId?: string }) => void;
  };
  openScreen?: (input: { screenId: string; params?: Record<string, string> }) => void;
}

/** Opens the chat and marks it read. A surface that has no way to navigate leaves the chat unread. */
export function openChat(store: RecentsStore, row: TriageRow, target: OpenTarget): void {
  const { navigation, openScreen } = target;
  if (navigation) navigation.openAgent({ agentId: row.agentId, serverId: row.hostId });
  else if (openScreen) openScreen({ screenId: GO_SCREEN_ID, params: { agentId: row.agentId, serverId: row.hostId } });
  else return;
  // A waiting chat keeps its place in Needs you (grey) until another chat is open; see linger.ts.
  if (row.bucket === "unread") {
    const status = store.getSnapshot().chats.find((chat) => chat.hostId === row.hostId && chat.agentId === row.agentId)?.status;
    if (status) holdOpened(row.key, row.sortAt, status);
  }
  store.markRead([row.key]);
}

/** Opens the chat with `key` from the visit history: like a row when it is listed, else by its key. */
export function openChatByKey(store: RecentsStore, rows: readonly TriageRow[], key: string, target: OpenTarget): void {
  const row = rows.find((candidate) => candidate.key === key);
  if (row) {
    openChat(store, row, target);
    return;
  }
  const hostId = key.slice(0, key.indexOf(":"));
  const agentId = key.slice(key.indexOf(":") + 1);
  if (target.navigation) target.navigation.openAgent({ agentId, serverId: hostId });
  else target.openScreen?.({ screenId: GO_SCREEN_ID, params: { agentId, serverId: hostId } });
}
