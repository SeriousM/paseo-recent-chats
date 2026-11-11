// Pure operations on the row layout: normalising stored values, editing, and resolving what a row shows.
// A layout is an array of tokens. Each token has a line; lines are numbered 1..n without gaps and
// the array is ordered by line, then by position within the line.
import { DEFAULT_LAYOUT, MAX_LINES, MAX_TOKEN_CHARS, type RowToken, type RowTokenId } from "../shared/layout";
import { agentLabel, chatTitle, ellipsize, formatAge } from "./format";
import type { TriageRow } from "./triage";

/** Whether a token shows in monospace: its own choice, else the default for that item. */
export function tokenMono(token: RowToken): boolean {
  return token.mono ?? DEFAULT_LAYOUT.find((fallback) => fallback.id === token.id)?.mono ?? false;
}

const clampChars = (value: number): number => Math.min(MAX_TOKEN_CHARS, Math.max(0, Math.trunc(value) || 0));

/** Lines as arrays of tokens, in order. Empty lines do not exist. */
export function linesOf(layout: readonly RowToken[]): RowToken[][] {
  const numbers = [...new Set(layout.map((token) => token.line))].sort((a, b) => a - b);
  return numbers.map((line) => layout.filter((token) => token.line === line));
}

/** Flatten lines back into a layout, numbering the non-empty ones 1..n. */
function fromLines(lines: readonly (readonly RowToken[])[]): RowToken[] {
  const result: RowToken[] = [];
  let number = 0;
  for (const line of lines) {
    if (line.length === 0) continue;
    number += 1;
    for (const token of line) result.push({ ...token, line: Math.min(number, MAX_LINES) });
  }
  return result;
}

/**
 * Stored layouts may miss a token (added in a later version) or repeat one. Keep the first of each,
 * append missing ones switched off on their default line, clamp lengths, and close gaps in the line numbers.
 */
export function normalizeLayout(input: readonly RowToken[]): RowToken[] {
  const seen = new Set<RowTokenId>();
  const tokens: RowToken[] = [];
  for (const token of input) {
    if (seen.has(token.id)) continue;
    seen.add(token.id);
    tokens.push({ ...token, maxChars: clampChars(token.maxChars), mono: tokenMono(token) });
  }
  for (const fallback of DEFAULT_LAYOUT) {
    if (!seen.has(fallback.id)) tokens.push({ ...fallback, enabled: false });
  }
  return fromLines(linesOf(tokens));
}

export function resetLayout(): RowToken[] {
  return DEFAULT_LAYOUT.map((token) => ({ ...token }));
}

/** Switched-on tokens per line, in order. Lines with nothing switched on are left out. */
export function visibleLines(layout: readonly RowToken[]): RowToken[][] {
  return linesOf(layout)
    .map((line) => line.filter((token) => token.enabled))
    .filter((line) => line.length > 0);
}

function replace(layout: readonly RowToken[], id: RowTokenId, change: Partial<RowToken>): RowToken[] {
  return layout.map((token) => (token.id === id ? { ...token, ...change } : token));
}

export const setEnabled = (layout: readonly RowToken[], id: RowTokenId, enabled: boolean): RowToken[] =>
  replace(layout, id, { enabled });

/** True when two layouts have the same tokens in the same order with the same settings. */
export function sameLayout(a: readonly RowToken[], b: readonly RowToken[]): boolean {
  return (
    a.length === b.length &&
    a.every((token, i) => {
      const other = b[i];
      return (
        other !== undefined &&
        token.id === other.id &&
        token.enabled === other.enabled &&
        token.line === other.line &&
        token.maxChars === other.maxChars &&
        tokenMono(token) === tokenMono(other)
      );
    })
  );
}

export const setMono = (layout: readonly RowToken[], id: RowTokenId, mono: boolean): RowToken[] =>
  replace(layout, id, { mono });

export const setMaxChars = (layout: readonly RowToken[], id: RowTokenId, maxChars: number): RowToken[] =>
  replace(layout, id, { maxChars: clampChars(maxChars) });

function without(layout: readonly RowToken[], id: RowTokenId): { token: RowToken | undefined; lines: RowToken[][] } {
  return {
    token: layout.find((candidate) => candidate.id === id),
    lines: linesOf(layout).map((line) => line.filter((candidate) => candidate.id !== id)),
  };
}

/**
 * Put a token into an existing line at a position (0 = first). The index counts the line without the
 * token itself, so dropping a token where it already is changes nothing.
 */
export function placeToken(layout: readonly RowToken[], id: RowTokenId, line: number, index: number): RowToken[] {
  const { token, lines } = without(layout, id);
  if (!token) return [...layout];
  const target = lines[line - 1];
  if (!target) return placeTokenOnNewLine(layout, id, lines.length + 1);
  target.splice(Math.max(0, Math.min(index, target.length)), 0, token);
  return fromLines(lines);
}

/** Put a token alone on a new line that becomes line `atLine` (1 = above everything). */
export function placeTokenOnNewLine(layout: readonly RowToken[], id: RowTokenId, atLine: number): RowToken[] {
  const { token, lines } = without(layout, id);
  if (!token) return [...layout];
  const compact = lines.filter((line) => line.length > 0);
  compact.splice(Math.max(0, Math.min(atLine - 1, compact.length)), 0, [token]);
  return fromLines(compact);
}

/**
 * Move a token one place up or down. At the edge of a line it crosses into the neighbouring line
 * (end of the line above, start of the line below). The very first and very last place stay put.
 */
export function moveToken(layout: readonly RowToken[], id: RowTokenId, direction: -1 | 1): RowToken[] {
  const lines = linesOf(layout);
  const lineIndex = lines.findIndex((line) => line.some((token) => token.id === id));
  if (lineIndex === -1) return [...layout];
  const line = lines[lineIndex] ?? [];
  const position = line.findIndex((token) => token.id === id);
  const to = position + direction;
  if (to >= 0 && to < line.length) {
    const reordered = [...line];
    const [moved] = reordered.splice(position, 1);
    if (moved) reordered.splice(to, 0, moved);
    return fromLines(lines.map((candidate, i) => (i === lineIndex ? reordered : candidate)));
  }
  const neighbour = lines[lineIndex + direction];
  if (!neighbour) return [...layout];
  return direction === -1
    ? placeToken(layout, id, lineIndex, neighbour.length)
    : placeToken(layout, id, lineIndex + 2, 0);
}

/** Give a token a line of its own right below the line it is on. Does nothing when it is already alone. */
export function ownLine(layout: readonly RowToken[], id: RowTokenId): RowToken[] {
  const lines = linesOf(layout);
  const lineIndex = lines.findIndex((line) => line.some((token) => token.id === id));
  if (lineIndex === -1 || (lines[lineIndex]?.length ?? 0) < 2) return [...layout];
  return placeTokenOnNewLine(layout, id, lineIndex + 2);
}

/** The full, untruncated text of a token for a row. The status light has none. */
export function tokenValue(row: TriageRow, id: RowTokenId): string {
  switch (id) {
    case "host":
      return row.hostLabel;
    case "project":
      return row.projectName;
    case "workspace":
      return row.workspaceName;
    case "title":
      return chatTitle(row.title, row.provider, row.agentId);
    case "branch":
      return row.branch;
    case "agent":
      return row.agentName || agentLabel(null, row.provider);
    case "age":
      return formatAge(Date.now() - row.sortAt);
    default:
      return "";
  }
}

/** What a row shows for a token: the value cut to `maxChars` (0 = unlimited). */
export function tokenText(row: TriageRow, token: RowToken): string {
  const value = tokenValue(row, token.id);
  return token.maxChars > 0 ? ellipsize(value, token.maxChars) : value;
}

/**
 * Column width in characters per capped token: the longest cut value among `rows`, never more than
 * the cap, so columns line up without wasting space. Unlimited tokens are absent (they flex), and a
 * column that is empty for every row has width 0 (it is left out).
 */
export function columnChars(
  rows: readonly TriageRow[],
  layout: readonly RowToken[],
): Partial<Record<RowTokenId, number>> {
  const widths: Partial<Record<RowTokenId, number>> = {};
  for (const token of layout) {
    if (!token.enabled || token.id === "led" || token.maxChars === 0) continue;
    let longest = 0;
    for (const row of rows) longest = Math.max(longest, Array.from(tokenText(row, token)).length);
    widths[token.id] = longest;
  }
  return widths;
}
