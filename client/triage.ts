// Pure triage rules. No React, no SDK imports: unit-testable and Hermes-safe.
import { SECTIONS, type Section } from "../shared/sections";

export type AttentionReason = "finished" | "error" | "permission";
export type AgentStatus = "initializing" | "idle" | "running" | "error" | "closed";
export type Bucket = "unread" | "running" | "inactive";
export type Led = "permission" | "error" | "finished" | "running" | "idle";

export interface ChatInput {
  hostId: string;
  hostLabel: string;
  agentId: string;
  workspaceId: string | null;
  projectName: string;
  workspaceName: string;
  /** Git branch of the chat's workspace; empty when it has none. */
  branch: string;
  /** Short model name, e.g. "opus-5.5"; the provider when the model is unknown. */
  agentName: string;
  title: string | null;
  provider: string;
  status: AgentStatus;
  /** Start of the active turn, epoch ms. */
  startedAt: number | null;
  lastUserMessageAt: number | null;
  updatedAt: number;
  /** Present when the daemon flags the chat (requiresAttention). `at` is attentionTimestamp. */
  attention: { reason: AttentionReason | null; at: number } | null;
}

export type OverlayEntry = {
  unreadAt?: number;
  dismissedAt?: number;
  /** Set while the chat is pinned: it is listed in the Pinned section, whatever its state. */
  pinnedAt?: number;
}
export type Overlay = Readonly<Record<string, OverlayEntry>>;

export interface TriageLimits {
  maxUnread: number;
  maxRunning: number;
  maxInactive: number;
  inactiveWindowDays: number;
  unreadExpiryDays: number;
}

export interface TriageRow {
  key: string;
  hostId: string;
  hostLabel: string;
  agentId: string;
  workspaceId: string | null;
  projectName: string;
  workspaceName: string;
  branch: string;
  agentName: string;
  title: string | null;
  provider: string;
  bucket: Bucket;
  /** Pinned chats form their own section, in the order they were pinned. `bucket` and `led` still show their state. */
  pinned: boolean;
  led: Led;
  /** Value the bucket sorts on, epoch ms. */
  sortAt: number;
}

export interface TriageResult {
  /** Capped list for compact surfaces, in display order. */
  rows: TriageRow[];
  /** Every chat in display order, for the full screen. */
  all: TriageRow[];
  /** Chats per state. Pinned chats count in their state too. */
  counts: Record<Bucket, number>;
  /** Number of pinned chats. */
  pinned: number;
  /** Rows present in `all` but cut from `rows`, per bucket (inactive counts only chats inside the window). */
  hidden: Record<Bucket, number>;
  /** Most urgent LED among unread chats, null when nothing is unread. */
  worstUnread: Led | null;
}

const DAY_MS = 86_400_000;

export const chatKey = (hostId: string, agentId: string): string => `${hostId}:${agentId}`;

/** The host a chat key belongs to: the part before the first colon. */
export const keyHost = (key: string): string => key.slice(0, key.indexOf(":"));

/**
 * Unread when the daemon flags attention newer than the last dismissal, or the
 * user marked it Later after the last dismissal. Each source expires on its own: an old
 * native flag does not hide a fresh Later mark.
 */
function unreadState(
  chat: ChatInput,
  entry: OverlayEntry | undefined,
  limits: TriageLimits,
  now: number,
): { sortAt: number; led: Led; blocked: boolean } | null {
  const dismissedAt = entry?.dismissedAt ?? 0;
  const cutoff = now - limits.unreadExpiryDays * DAY_MS;
  const fresh = (at: number) => at > dismissedAt && at >= cutoff;
  const native = chat.attention && fresh(chat.attention.at) ? chat.attention : null;
  const manualAt = entry?.unreadAt !== undefined && fresh(entry.unreadAt) ? entry.unreadAt : null;
  if (!native && manualAt === null) return null;
  const sortAt = Math.min(native ? native.at : Infinity, manualAt ?? Infinity);
  const led: Led = native
    ? native.reason === "permission"
      ? "permission"
      : native.reason === "error"
        ? "error"
        : "finished"
    : "finished";
  return { sortAt, led, blocked: native?.reason === "permission" };
}

const compare = (a: TriageRow, b: TriageRow, direction: 1 | -1): number =>
  (a.sortAt - b.sortAt) * direction ||
  a.hostId.localeCompare(b.hostId) ||
  a.agentId.localeCompare(b.agentId);

const LED_RANK: Record<Led, number> = { permission: 0, error: 1, finished: 2, running: 3, idle: 4 };

export interface TriageOptions {
  /** Triage each host on its own: caps apply per host and rows come out host by host. */
  groupByHost?: boolean;
  /** Host order for grouped output (serverIds). Hosts not listed follow, by label. */
  hostOrder?: readonly string[];
  /** Order of the sections in `rows` and `all`. Default: pinned, unread, running, inactive. */
  sectionOrder?: readonly Section[];
}

export function buildTriage(
  chats: readonly ChatInput[],
  overlay: Overlay,
  limits: TriageLimits,
  now: number,
  options: TriageOptions = {},
): TriageResult {
  if (!options.groupByHost) return triageOne(chats, overlay, limits, now, options.sectionOrder);

  const byHost = new Map<string, ChatInput[]>();
  for (const chat of chats) {
    const list = byHost.get(chat.hostId);
    if (list) list.push(chat);
    else byHost.set(chat.hostId, [chat]);
  }
  const order = options.hostOrder ?? [];
  const rank = (hostId: string) => {
    const index = order.indexOf(hostId);
    return index === -1 ? order.length : index;
  };
  const hostIds = [...byHost.keys()].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (byHost.get(a)?.[0]?.hostLabel ?? "").localeCompare(byHost.get(b)?.[0]?.hostLabel ?? "") ||
      a.localeCompare(b),
  );

  const merged: TriageResult = {
    rows: [],
    all: [],
    counts: { unread: 0, running: 0, inactive: 0 },
    pinned: 0,
    hidden: { unread: 0, running: 0, inactive: 0 },
    worstUnread: null,
  };
  for (const hostId of hostIds) {
    const part = triageOne(byHost.get(hostId) ?? [], overlay, limits, now, options.sectionOrder);
    merged.rows.push(...part.rows);
    merged.all.push(...part.all);
    merged.pinned += part.pinned;
    for (const bucket of ["unread", "running", "inactive"] as const) {
      merged.counts[bucket] += part.counts[bucket];
      merged.hidden[bucket] += part.hidden[bucket];
    }
    if (
      part.worstUnread !== null &&
      (merged.worstUnread === null || LED_RANK[part.worstUnread] < LED_RANK[merged.worstUnread])
    ) {
      merged.worstUnread = part.worstUnread;
    }
  }
  return merged;
}

function triageOne(
  chats: readonly ChatInput[],
  overlay: Overlay,
  limits: TriageLimits,
  now: number,
  sectionOrder: readonly Section[] = SECTIONS,
): TriageResult {
  const unread: TriageRow[] = [];
  const running: TriageRow[] = [];
  const inactive: TriageRow[] = [];
  const pinned: { row: TriageRow; at: number }[] = [];

  for (const chat of chats) {
    const key = chatKey(chat.hostId, chat.agentId);
    const base = {
      key,
      hostId: chat.hostId,
      hostLabel: chat.hostLabel,
      agentId: chat.agentId,
      workspaceId: chat.workspaceId,
      projectName: chat.projectName,
      workspaceName: chat.workspaceName,
      branch: chat.branch,
      agentName: chat.agentName,
      title: chat.title,
      provider: chat.provider,
    };
    const pinnedAt = overlay[key]?.pinnedAt;
    const isPinned = pinnedAt !== undefined;
    const state = unreadState(chat, overlay[key], limits, now);
    let row: TriageRow;
    // The daemon keeps its "finished" or "error" flag while the chat works on a new turn. That flag is about
    // the turn before: a running chat shows as running, and turns unread again when this turn ends. Only a
    // chat that waits for a permission needs you while it runs.
    if (state && !(chat.status === "running" && !state.blocked)) {
      row = { ...base, bucket: "unread", pinned: isPinned, led: state.led, sortAt: state.sortAt };
      unread.push(row);
    } else if (chat.status === "running") {
      row = {
        ...base,
        bucket: "running",
        pinned: isPinned,
        led: "running",
        sortAt: chat.startedAt ?? chat.updatedAt,
      };
      running.push(row);
    } else {
      row = {
        ...base,
        bucket: "inactive",
        pinned: isPinned,
        led: "idle",
        sortAt: chat.lastUserMessageAt ?? chat.updatedAt,
      };
      inactive.push(row);
    }
    if (pinnedAt !== undefined) pinned.push({ row, at: pinnedAt });
  }

  unread.sort((a, b) => compare(a, b, 1));
  running.sort((a, b) => compare(a, b, 1));
  inactive.sort((a, b) => compare(a, b, -1));

  pinned.sort((a, b) => a.at - b.at || a.row.hostId.localeCompare(b.row.hostId) || a.row.agentId.localeCompare(b.row.agentId));
  const pinnedRows = pinned.map((entry) => entry.row);

  // Caps and the inactive window apply to chats that are not pinned; a pinned chat is always listed.
  const loose = (rows: TriageRow[]) => rows.filter((row) => !row.pinned);
  const looseUnread = loose(unread);
  const looseRunning = loose(running);
  const windowStart = now - limits.inactiveWindowDays * DAY_MS;
  const looseInactive = loose(inactive).filter((row) => row.sortAt >= windowStart);

  const shownBy: Record<Section, TriageRow[]> = {
    pinned: pinnedRows,
    unread: looseUnread.slice(0, limits.maxUnread),
    running: looseRunning.slice(0, limits.maxRunning),
    inactive: looseInactive.slice(0, limits.maxInactive),
  };
  const allBy: Record<Section, TriageRow[]> = {
    pinned: pinnedRows,
    unread: looseUnread,
    running: looseRunning,
    inactive: loose(inactive),
  };
  const rows = sectionOrder.flatMap((section) => shownBy[section]);

  let worstUnread: Led | null = null;
  for (const row of unread) {
    if (worstUnread === null || LED_RANK[row.led] < LED_RANK[worstUnread]) worstUnread = row.led;
  }

  return {
    rows,
    all: sectionOrder.flatMap((section) => allBy[section]),
    counts: { unread: unread.length, running: running.length, inactive: inactive.length },
    pinned: pinnedRows.length,
    hidden: {
      unread: Math.max(0, looseUnread.length - limits.maxUnread),
      running: Math.max(0, looseRunning.length - limits.maxRunning),
      inactive: Math.max(0, looseInactive.length - limits.maxInactive),
    },
    worstUnread,
  };
}

/** The row "Later" should jump to: the top of the list, never the chat being left. */
export function nextUp(result: TriageResult, excludeKey: string | null): TriageRow | null {
  const unread = result.all.find((row) => row.bucket === "unread" && row.key !== excludeKey);
  if (unread) return unread;
  return result.all.find((row) => row.key !== excludeKey && row.bucket !== "inactive") ?? null;
}

/** Label Paseo puts on agents that another agent started (sub-agents). */
export const PARENT_AGENT_LABEL = "paseo.parent-agent-id";

/** True for sub-agents: chats an agent delegated to, which this inbox never lists. */
export function isDelegated(labels: Readonly<Record<string, string>> | undefined): boolean {
  return (labels?.[PARENT_AGENT_LABEL]?.trim().length ?? 0) > 0;
}
