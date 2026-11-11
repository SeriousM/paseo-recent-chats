// Positions for drag and drop, measured when a drag starts. onLayout is not enough: on the web it only
// reports size changes, so an item that moved without resizing (after an earlier reorder) keeps its old
// position and the drop marker lands in the wrong place.
import type { View } from "react-native";

export interface Box {
  top: number;
  height: number;
}

/** Top and height of each node relative to `container`; `done` gets every box that could be measured. */
export function measureIn(container: View | null, nodes: ReadonlyMap<string, View | null>, done: (boxes: Map<string, Box>) => void) {
  const boxes = new Map<string, Box>();
  const entries = [...nodes].filter((entry): entry is [string, View] => entry[1] !== null);
  if (!container || entries.length === 0) {
    done(boxes);
    return;
  }
  let pending = entries.length;
  const settle = () => {
    pending -= 1;
    if (pending === 0) done(boxes);
  };
  for (const [key, node] of entries) {
    node.measureLayout(
      container,
      (_x, y, _width, height) => {
        boxes.set(key, { top: y, height });
        settle();
      },
      settle,
    );
  }
}
