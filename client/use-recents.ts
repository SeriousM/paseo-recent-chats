import { useHosts } from "@getpaseo/plugin/client";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { getStore } from "./runtime";
import type { RecentsStore, StoreSnapshot } from "./store";
import { buildTriage, type TriageLimits, type TriageResult, type TriageRow } from "./triage";
import type { Prefs } from "../shared/settings";

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
  const result = useMemo(
    () =>
      buildTriage(snapshot.chats, snapshot.overlay, limitsOf(snapshot.prefs), Date.now(), {
        groupByHost: snapshot.prefs.groupByHost,
        hostOrder: snapshot.hosts.map((host) => host.id),
      }),
    [snapshot],
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
  store.markRead([row.key]);
}
