// The terminals of every host, for the Projects tree, the Triage search and back/forward. Paseo 0.16 lists
// them to plugins only through a React hook (useTerminals) on surfaces it hosts, and opens one only by its
// own reference object, so the surfaces that can (TerminalFeed) publish the list here. Shared on globalThis:
// every host's copy of the plugin reads the same list. Like peers.ts, the shape is a contract between plugin
// versions: change it together with the key.
import * as pluginClient from "@getpaseo/plugin/client";
import type { PluginTerminalSnapshot } from "@getpaseo/plugin";
import type { TerminalRef } from "@getpaseo/plugin/client";
import { Component, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";
import { getTerminalOpener } from "./runtime";

const KEY = "__paseoRecentChats.terminals.v1";

export interface TerminalInfo {
  /** `${hostId}:terminal:${id}`, the key back/forward records. */
  key: string;
  hostId: string;
  id: string;
  workspaceId: string;
  title: string;
  /** Paseo's own reference: the only way to open the terminal. */
  ref: TerminalRef;
}

interface Shared {
  list: readonly TerminalInfo[];
  /** Hosts whose terminals the list holds; a terminal of another host is unknown, not gone. */
  hosts: ReadonlySet<string>;
  listeners: Set<() => void>;
}

const shared = (): Shared =>
  ((globalThis as Record<string, unknown>)[KEY] ??= { list: [], hosts: new Set(), listeners: new Set() }) as Shared;

const MARK = ":terminal:";
export const terminalKey = (hostId: string, id: string): string => `${hostId}${MARK}${id}`;
export const isTerminalKey = (key: string): boolean => key.includes(MARK);

function publish(list: readonly TerminalInfo[], hosts: ReadonlySet<string>): void {
  const state = shared();
  const same =
    list.length === state.list.length &&
    list.every((item, index) => {
      const old = state.list[index];
      return old?.ref === item.ref && old.title === item.title && old.workspaceId === item.workspaceId;
    }) &&
    hosts.size === state.hosts.size &&
    [...hosts].every((host) => state.hosts.has(host));
  if (same) return;
  state.list = list;
  state.hosts = hosts;
  for (const listener of [...state.listeners]) {
    try {
      listener();
    } catch {
      // Another copy's failing listener must not keep the rest from updating.
    }
  }
}

export const currentTerminals = (): readonly TerminalInfo[] => shared().list;

export function useTerminalList(): readonly TerminalInfo[] {
  return useSyncExternalStore((listener) => {
    const state = shared();
    state.listeners.add(listener);
    return () => void state.listeners.delete(listener);
  }, currentTerminals);
}

/** True when the terminal's host is listed and no longer has it (closed); false when unsure. */
export function isTerminalGone(key: string): boolean {
  const state = shared();
  const hostId = key.slice(0, key.indexOf(MARK));
  return state.hosts.has(hostId) && !state.list.some((item) => item.key === key);
}

/** Opens the terminal's tab; false when it is not known here or this Paseo cannot. */
export function openTerminalByKey(key: string): boolean {
  const info = shared().list.find((item) => item.key === key);
  const open = getTerminalOpener();
  if (!info || !open) return false;
  open(info.ref);
  return true;
}

// The workspace, creation time and title ride along in the group descriptor: the hook hands out only references.
const describe = (terminal: PluginTerminalSnapshot) => ({
  key: JSON.stringify([terminal.ref.hostId, terminal.ref.id, terminal.workspace.id]),
  title: terminal.title,
});

/** Reads Paseo's terminal list of the online hosts and publishes it. Renders nothing. */
function Feed({ hosts }: { hosts: readonly string[] }) {
  const groups = pluginClient.useTerminals({ hosts, groupBy: describe });
  const list = useMemo(
    () =>
      groups.flatMap((group) => {
        const [hostId, id, workspaceId] = JSON.parse(group.key) as [string, string, string];
        const ref = group.items[0];
        return ref ? [{ key: terminalKey(hostId, id), hostId, id, workspaceId, title: group.title ?? "", ref }] : [];
      }),
    [groups],
  );
  useEffect(() => publish(list, new Set(hosts)), [list, hosts]);
  return null;
}

/** Paseo throws from the hook when a host's terminal list fails, or outside a surface it hosts: then no feed. */
class Guard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Mount in surfaces Paseo hosts (sidebar, screens): keeps the shared terminal list current. Paseo 0.16 and later. */
export function TerminalFeed() {
  const online = pluginClient.useHosts().filter((host) => host.status === "online");
  const key = online.map((host) => host.serverId).join(",");
  const hosts = useMemo(() => (key ? key.split(",") : []), [key]);
  if (typeof (pluginClient as { useTerminals?: unknown }).useTerminals !== "function") return null;
  return (
    <Guard key={key}>
      <Feed hosts={hosts} />
    </Guard>
  );
}
