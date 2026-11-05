// Fuzzy matching for the search box. Pure.
// A query matches a field when its characters appear in order (not necessarily next to each other).
// Closer, earlier, word-aligned matches score higher.
import type { TriageRow } from "./triage";
import { tokenValue } from "./row-layout";

const BASE = 3;
const CONSECUTIVE = 5;
const WORD_START = 6;
const TEXT_START = 4;
const EXACT_CASE = 1;
const GAP = 0.5;
const MIN_PER_CHAR = 4;
const WHOLE_QUERY = 12;

const isWordChar = (char: string | undefined): boolean => char !== undefined && /[\p{L}\p{N}]/u.test(char);

/** True at the first letter of a word: after a separator, or a capital after a lower-case letter. */
function isWordStart(text: readonly string[], index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1];
  const current = text[index];
  if (!isWordChar(previous)) return true;
  return previous !== undefined && current !== undefined && previous === previous.toLowerCase() && current !== current.toLowerCase();
}

/**
 * Score of `query` (no spaces) inside `text`, or null when it does not match well enough.
 * Dynamic programming over (query char, text position), O(query x text).
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = Array.from(query.toLowerCase());
  const original = Array.from(text);
  const t = original.map((char) => char.toLowerCase());
  if (q.length === 0) return 0;
  if (q.length > t.length) return null;
  const queryOriginal = Array.from(query);

  const NEG = Number.NEGATIVE_INFINITY;
  // best[i][j]: best score with query char i matched at text position j.
  let previous: number[] = [];
  for (let i = 0; i < q.length; i++) {
    const current: number[] = new Array<number>(t.length).fill(NEG);
    // Running maximum of previous[k] + GAP * k for k < j - 1, so a skip of d characters costs GAP * d.
    let skipBest = NEG;
    for (let j = 0; j < t.length; j++) {
      if (j >= 2 && i > 0) skipBest = Math.max(skipBest, (previous[j - 2] ?? NEG) + GAP * (j - 2));
      if (t[j] !== q[i]) continue;
      let gain = BASE;
      if (isWordStart(original, j)) gain += WORD_START;
      if (j === 0) gain += TEXT_START;
      if (original[j] === queryOriginal[i]) gain += EXACT_CASE;
      if (i === 0) {
        // Characters before the first match are skipped at the same cost.
        current[j] = gain - GAP * j;
      } else {
        const adjacent = j >= 1 ? (previous[j - 1] ?? NEG) + CONSECUTIVE : NEG;
        const skipped = skipBest === NEG ? NEG : skipBest - GAP * (j - 1);
        const best = Math.max(adjacent, skipped);
        if (best !== NEG) current[j] = best + gain;
      }
    }
    previous = current;
  }
  const best = Math.max(...previous);
  if (best < q.length * MIN_PER_CHAR) return null;
  // The whole query as one run of text beats the same letters picked out of several words.
  return t.join("").includes(q.join("")) ? best + WHOLE_QUERY : best;
}

/** Fields a chat is searched in, with a weight each. The tab name counts most. */
const FIELDS = [
  ["title", 1],
  ["project", 0.8],
  ["workspace", 0.8],
  ["branch", 0.7],
  ["agent", 0.6],
  ["host", 0.6],
] as const;

/**
 * Score of a whole query against a chat. The query splits at spaces; every word must match some
 * field of the chat (a word does not have to match the same field as another). Null = no match.
 */
export function scoreRow(query: string, row: TriageRow): number | null {
  const words = query.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 0;
  let total = 0;
  for (const word of words) {
    let best: number | null = null;
    for (const [id, weight] of FIELDS) {
      const score = fuzzyScore(word, tokenValue(row, id));
      if (score !== null && (best === null || score * weight > best)) best = score * weight;
    }
    if (best === null) return null;
    total += best;
  }
  return total;
}

/** Rows that match, best match first; equal scores keep their incoming (triage) order. Empty query keeps everything. */
export function searchRows(query: string, rows: readonly TriageRow[]): TriageRow[] {
  if (query.trim() === "") return [...rows];
  const scored: { row: TriageRow; score: number; order: number }[] = [];
  rows.forEach((row, order) => {
    const score = scoreRow(query, row);
    if (score !== null) scored.push({ row, score, order });
  });
  scored.sort((a, b) => b.score - a.score || a.order - b.order);
  return scored.map((entry) => entry.row);
}
