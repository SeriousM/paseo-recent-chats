import { describe, expect, it } from "vitest";
import { dropTarget, markerY, type DragGeometry } from "../client/drag-target";

// Two lines of 3 and 2 rows, each row 40 high, a 20 high section header above the rows.
//   line 1 section top 0:  rows at 20, 60, 100   (ids host, led, project)
//   line 2 section top 160: rows at 180, 220     (ids title, branch)
//   new-line zone top 280
const geometry: DragGeometry = {
  rows: [
    { id: "host", line: 1, top: 20, height: 40 },
    { id: "led", line: 1, top: 60, height: 40 },
    { id: "project", line: 1, top: 100, height: 40 },
    { id: "title", line: 2, top: 180, height: 40 },
    { id: "branch", line: 2, top: 220, height: 40 },
  ],
  lineTops: [0, 160],
  newLineTop: 280,
};

describe("dropTarget", () => {
  it("drops before a row when the pointer is above its middle", () => {
    expect(dropTarget(70, geometry, "host")).toEqual({ line: 1, index: 0 });
    expect(dropTarget(110, geometry, "host")).toEqual({ line: 1, index: 1 });
  });

  it("drops after a row when the pointer is below its middle", () => {
    expect(dropTarget(85, geometry, "branch")).toEqual({ line: 1, index: 2 });
  });

  it("counts the line without the dragged row", () => {
    // Pointer over where "led" sits: with "led" dragged, "host" is first and "project" second.
    expect(dropTarget(80, geometry, "led")).toEqual({ line: 1, index: 1 });
  });

  it("drops at the end of a line when the pointer is between its last row and the next section", () => {
    expect(dropTarget(150, geometry, "title")).toEqual({ line: 1, index: 3 });
    expect(dropTarget(270, geometry, "host")).toEqual({ line: 2, index: 2 });
  });

  it("drops at the start of the next line when the pointer is on its header", () => {
    expect(dropTarget(165, geometry, "host")).toEqual({ line: 2, index: 0 });
  });

  it("starts a new line below the last line", () => {
    expect(dropTarget(300, geometry, "host")).toEqual({ newLineAt: 3 });
    expect(dropTarget(5000, geometry, "host")).toEqual({ newLineAt: 3 });
  });

  it("lets a pointer above everything drop first in line 1", () => {
    expect(dropTarget(-30, geometry, "branch")).toEqual({ line: 1, index: 0 });
  });

  it("handles a line that only holds the dragged row", () => {
    const alone: DragGeometry = {
      rows: [
        { id: "host", line: 1, top: 20, height: 40 },
        { id: "title", line: 2, top: 100, height: 40 },
      ],
      lineTops: [0, 80],
      newLineTop: 160,
    };
    expect(dropTarget(110, alone, "title")).toEqual({ line: 2, index: 0 });
  });
});

describe("markerY", () => {
  it("sits on the top of the row it will precede, or under the last row of the line", () => {
    expect(markerY({ line: 1, index: 1 }, geometry, "host")).toBe(100);
    expect(markerY({ line: 1, index: 2 }, geometry, "host")).toBe(140);
    expect(markerY({ line: 2, index: 2 }, geometry, "host")).toBe(260);
    expect(markerY({ newLineAt: 3 }, geometry, "host")).toBe(280);
  });

  it("uses the section top for a line that only holds the dragged row", () => {
    const alone: DragGeometry = {
      rows: [{ id: "title", line: 1, top: 20, height: 40 }],
      lineTops: [10],
      newLineTop: 90,
    };
    expect(markerY({ line: 1, index: 0 }, alone, "title")).toBe(10);
  });
});
