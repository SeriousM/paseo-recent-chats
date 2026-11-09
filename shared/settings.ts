import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_LAYOUT, rowTokenSchema } from "./layout";

/**
 * User-facing view options. On web and desktop they live in this device's own storage (client/web.ts),
 * so every host's copy of the plugin shows the same view. Phones have no such storage, so they keep
 * them in this host document. Written through the store, from the settings screen and the host chips.
 */
export const prefsSettings = defineSettings({
  id: "prefs",
  scope: "host",
  version: 1,
  schema: z.object({
    maxUnread: z.number().int().min(1).max(50).default(6),
    maxRunning: z.number().int().min(0).max(50).default(3),
    maxInactive: z.number().int().min(0).max(50).default(4),
    /** Inactive chats whose last message is older than this are left out of the capped list. */
    inactiveWindowDays: z.number().int().min(1).max(365).default(14),
    /** Unread chats waiting longer than this fall back to inactive so a stale item cannot own the top. */
    unreadExpiryDays: z.number().int().min(1).max(365).default(7),
    groupHeadings: z.boolean().default(true),
    sidebarExpanded: z.boolean().default(true),
    /** Most of the window height the sidebar list may take, in percent. Phone drawer and wide sidebar apart. */
    sidebarHeightPhone: z.number().int().min(15).max(85).default(40),
    sidebarHeightDesktop: z.number().int().min(15).max(85).default(50),
    /** What the Later pill does after marking a chat unread. */
    laterBehavior: z.enum(["jump", "stay"]).default("jump"),
    showInboxPill: z.boolean().default(true),
    showLaterPill: z.boolean().default(true),
    /** What each list row shows, in which order and how long. See shared/layout.ts. */
    layout: z.array(rowTokenSchema).default(() => DEFAULT_LAYOUT.map((token) => ({ ...token }))),
    /** Show the card with full names while hovering or long-pressing a row. */
    showTooltip: z.boolean().default(true),
    /** How see-through the full-names card is, in percent. 0 = solid. */
    tooltipTransparency: z.number().int().min(0).max(90).default(0),
    /** Show a heading per host and keep each host's chats together. Caps then apply per host. */
    groupByHost: z.boolean().default(false),
    /** Hosts switched off in the host filter (serverIds). A host not listed here is shown, so new hosts start on. */
    hiddenHosts: z.array(z.string()).default([]),
  }),
});

export type Prefs = z.output<typeof prefsSettings.schema>;

/**
 * Read/unread overlay on top of the daemon's own attention flag. Keys are
 * "<serverId>:<agentId>". Written by the client store, never by the user.
 * `unreadAt` is set by "Later"; `dismissedAt` by opening or "mark read".
 */
export const overlaySettings = defineSettings({
  id: "overlay",
  scope: "host",
  version: 1,
  schema: z.object({
    entries: z
      .record(
        z.string(),
        z.object({
          unreadAt: z.number().optional(),
          dismissedAt: z.number().optional(),
          pinnedAt: z.number().optional(),
        }),
      )
      .default({}),
  }),
});
