import { describe, expect, it } from "vitest";
import { currentLinger, followOpenChat, holdOpened } from "../client/linger";

describe("letting go of an opened chat", () => {
  it("holds while the previous chat is still reported, and lets go once another chat follows the opened one", () => {
    holdOpened("h1:a", 5, "idle");
    // The opened chat's composer has not shown up yet: the previous chat is still the open one.
    followOpenChat("h1:z");
    expect(currentLinger()?.key).toBe("h1:a");
    followOpenChat("h1:a");
    followOpenChat(null);
    expect(currentLinger()?.key).toBe("h1:a");
    followOpenChat("h1:b");
    expect(currentLinger()).toBeNull();
  });

  it("is replaced when another waiting chat is opened", () => {
    holdOpened("h1:a", 5, "idle");
    holdOpened("h1:c", 7, "running");
    expect(currentLinger()).toEqual({ key: "h1:c", sortAt: 7, status: "running" });
  });
});
