import { z } from "zod";

/** Everything a list row can show. Order, visibility, line and length are user settings. */
export const ROW_TOKEN_IDS = ["host", "led", "project", "workspace", "title", "branch", "agent", "age"] as const;
export type RowTokenId = (typeof ROW_TOKEN_IDS)[number];

/** Upper bound that only keeps stored data sane; a row can have as many lines as it has items. */
export const MAX_LINES = 99;

/** Longest cut a user can ask for; 0 means unlimited. */
export const MAX_TOKEN_CHARS = 200;

export const rowTokenSchema = z.object({
  id: z.enum(ROW_TOKEN_IDS),
  enabled: z.boolean(),
  /** 1-based line of the row. Lines are renumbered without gaps when the layout is normalised. */
  line: z.number().int().min(1).max(MAX_LINES),
  /** Characters kept before an ellipsis. 0 = unlimited. Ignored for the status light. */
  maxChars: z.number().int().min(0).max(MAX_TOKEN_CHARS),
  /** Show the text in a monospace font. Missing in layouts saved before the option existed: the default for the item applies. */
  mono: z.boolean().optional(),
});

export type RowToken = z.output<typeof rowTokenSchema>;

/**
 * [host] [status light] [project 10] [workspace 10] [tab name]
 * [branch 24] [agent name]
 * Age is off until switched on in the settings.
 */
export const DEFAULT_LAYOUT: readonly RowToken[] = [
  { id: "host", enabled: true, line: 1, maxChars: 6, mono: false },
  { id: "led", enabled: true, line: 1, maxChars: 0, mono: false },
  { id: "project", enabled: true, line: 1, maxChars: 10, mono: false },
  { id: "workspace", enabled: true, line: 1, maxChars: 10, mono: true },
  { id: "title", enabled: true, line: 1, maxChars: 0, mono: false },
  { id: "branch", enabled: true, line: 2, maxChars: 24, mono: true },
  { id: "agent", enabled: true, line: 2, maxChars: 0, mono: false },
  { id: "age", enabled: false, line: 2, maxChars: 0, mono: true },
];
