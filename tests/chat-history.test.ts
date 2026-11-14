import { describe, expect, it } from "vitest";
import { EMPTY_HISTORY, step, visit, type ChatHistory } from "../client/chat-history";

const T = 1_000_000;
const visitAll = (keys: readonly string[], from: ChatHistory = EMPTY_HISTORY, now = T) =>
  keys.reduce((history, key) => visit(history, key, now), from);

describe("chat visit history", () => {
  it("records each newly open chat once and goes back and forward through them", () => {
    const history = visitAll(["a", "b", "b", "c"]);
    expect(history).toMatchObject({ entries: ["a", "b", "c"], index: 2 });
    const back = step(history, -1, T);
    expect(back?.key).toBe("b");
    expect(step(back!.history, 1, T)?.key).toBe("c");
    expect(step(history, 1, T)).toBeNull();
    expect(step(EMPTY_HISTORY, -1, T)).toBeNull();
  });

  it("keeps forward while a step arrives: chats shown on the way do not count, its own chat ends the arrival", () => {
    const back = step(visitAll(["a", "b", "c"]), -1, T)!.history;
    // The chat being left and a tab behind it show up before "b" opens.
    const passing = visitAll(["c", "a"], back, T + 100);
    expect(passing).toMatchObject({ entries: ["a", "b", "c"], index: 1 });
    const arrived = visit(passing, "b", T + 200);
    expect(arrived).toMatchObject({ index: 1, arriving: null });
    expect(step(arrived, 1, T + 300)?.key).toBe("c");
  });

  it("opening another chat after arriving drops what lay ahead; a step that never arrives gives up", () => {
    const arrived = visit(step(visitAll(["a", "b", "c"]), -1, T)!.history, "b", T);
    expect(visit(arrived, "d", T)).toMatchObject({ entries: ["a", "b", "d"], index: 2 });
    const stuck = step(visitAll(["a", "b", "c"]), -1, T)!.history;
    expect(visit(stuck, "d", T + 10_000)).toMatchObject({ entries: ["a", "b", "d"], index: 2 });
  });

  it("keeps the newest 50 visits", () => {
    const history = visitAll(Array.from({ length: 60 }, (_, i) => `k${i}`));
    expect(history.entries).toHaveLength(50);
    expect(history.entries[0]).toBe("k10");
    expect(history.index).toBe(49);
  });
});
