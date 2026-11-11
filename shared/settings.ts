import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { DEFAULT_LAYOUT, rowTokenSchema } from "./layout";
import { DEFAULT_SECTION_SORT, SECTIONS } from "./sections";

/**
 * User-facing view options. Every host that runs this plugin keeps a copy, and the client writes each
 * change to all of them, so every device and every host shows the same view. `updatedAt` decides which
 * copy is current when they differ (a host was offline during a change). Written through the store.
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
    /** Order of the Pinned, Needs you, Running and Inactive sections; each listed exactly once. */
    sectionOrder: z
      .array(z.enum(SECTIONS))
      .refine((order) => order.length === SECTIONS.length && SECTIONS.every((section) => order.includes(section)), {
        message: "every section exactly once",
      })
      .default(() => [...SECTIONS]),
    /**
     * Order of the chats inside each section. Pinned sorts on when it was pinned, Needs you on when it
     * started waiting, Running on when its turn started, Inactive on its last message. Limits keep the first.
     */
    sectionSort: z
      .object({
        pinned: z.enum(["oldest", "newest"]).default(DEFAULT_SECTION_SORT.pinned),
        unread: z.enum(["oldest", "newest"]).default(DEFAULT_SECTION_SORT.unread),
        running: z.enum(["oldest", "newest"]).default(DEFAULT_SECTION_SORT.running),
        inactive: z.enum(["oldest", "newest"]).default(DEFAULT_SECTION_SORT.inactive),
      })
      .default(() => ({ ...DEFAULT_SECTION_SORT })),
    /** Each host checks GitHub for a newer version of this plugin every few hours and installs it. */
    autoUpdate: z.boolean().default(true),
    /** Share of the window height the sidebar list takes, in percent. Phone drawer and wide sidebar apart. */
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
    /** When these settings were last changed (ms). The newest copy across the hosts wins; 0 = never synced. */
    updatedAt: z.number().default(0),
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
