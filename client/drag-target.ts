// Where a dragged row would land. Pure: the editor measures, this decides.
import type { RowTokenId } from "../shared/layout";

export interface RowGeometry {
  id: RowTokenId;
  /** 1-based line the row is on. */
  line: number;
  /** Top and height in the editor's own coordinates. */
  top: number;
  height: number;
}

export interface DragGeometry {
  /** Every row, in display order (line by line). */
  rows: readonly RowGeometry[];
  /** Top of each line's section; index 0 is line 1. */
  lineTops: readonly number[];
  /** Top of the "new line" drop zone below the last line. */
  newLineTop: number;
}

export type Drop = { line: number; index: number } | { newLineAt: number };

/**
 * Drop position for a pointer at `pointerY` while `dragId` is dragged. The dragged row is ignored
 * (the index counts the line without it). Above a row's middle = before it; below the last row of
 * a line but above the next line's section = the end of that line; in the zone at the bottom = a
 * new line.
 */
export function dropTarget(pointerY: number, geometry: DragGeometry, dragId: RowTokenId): Drop {
  const lineCount = geometry.lineTops.length;
  if (pointerY >= geometry.newLineTop) return { newLineAt: lineCount + 1 };
  const others = geometry.rows.filter((row) => row.id !== dragId);
  for (let line = 1; line <= lineCount; line++) {
    const inLine = others.filter((row) => row.line === line);
    for (let index = 0; index < inLine.length; index++) {
      const row = inLine[index];
      if (row && pointerY < row.top + row.height / 2) return { line, index };
    }
    const nextTop = geometry.lineTops[line] ?? geometry.newLineTop;
    if (pointerY < nextTop) return { line, index: inLine.length };
  }
  return { newLineAt: lineCount + 1 };
}

/** Y of the insertion marker for a drop, in the editor's coordinates. */
export function markerY(drop: Drop, geometry: DragGeometry, dragId: RowTokenId): number {
  if ("newLineAt" in drop) return geometry.newLineTop;
  const inLine = geometry.rows.filter((row) => row.line === drop.line && row.id !== dragId);
  const before = inLine[drop.index];
  if (before) return before.top;
  const last = inLine[inLine.length - 1];
  return last ? last.top + last.height : (geometry.lineTops[drop.line - 1] ?? 0);
}
