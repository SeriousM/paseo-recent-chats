import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, step, visit, type ChatHistory } from "../client/chat-history";

const visitAll = (keys: readonly string[], from: ChatHistory = EMPTY_HISTORY) => keys.reduce(visit, from);

describe("chat visit history", () => {
  it("records each newly open chat once and goes back and forward through them", () => {
    const history = visitAll(["a", "b", "b", "c"]);
    expect(history).toEqual({ entries: ["a", "b", "c"], index: 2 });
    const back = step(history, -1);
    expect(back?.key).toBe("b");
    expect(step(back!.history, 1)?.key).toBe("c");
    expect(step(history, 1)).toBeNull();
    expect(step(EMPTY_HISTORY, -1)).toBeNull();
  });

  it("landing on the chat it went back to records nothing; opening another drops what lay ahead", () => {
    const back = step(visitAll(["a", "b", "c"]), -1)!.history;
    expect(visit(back, "b")).toBe(back);
    expect(visit(back, "d")).toEqual({ entries: ["a", "b", "d"], index: 2 });
  });

  it("keeps the newest 50 visits", () => {
    const history = visitAll(Array.from({ length: 60 }, (_, i) => `k${i}`));
    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]).toBe("k10");
    expect(history.index).toBe(49);
  });
});
