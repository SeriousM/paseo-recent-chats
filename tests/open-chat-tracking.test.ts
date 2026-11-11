import { describe, expect, it } from "vitest";
import { reportOpenChat } from "../client/open-chat";

const KEY = "__paseoRecentChats.openChats.v1";
const mounted = () => (globalThis as unknown as Record<string, { mounted: string[] }>)[KEY]?.mounted.at(-1) ?? null;

describe("open chat tracking", () => {
  it("takes the newest shown chat, and falls back to the one below when it goes", () => {
    const first = reportOpenChat("h1:a");
    const second = reportOpenChat("h2:b");
    expect(mounted()).toBe("h2:b");
    second();
    expect(mounted()).toBe("h1:a");
    first();
    expect(mounted()).toBeNull();
  });

  it("keeps a chat open while another icon of the same chat is still shown", () => {
    const inbox = reportOpenChat("h1:a");
    const later = reportOpenChat("h1:a");
    inbox();
    expect(mounted()).toBe("h1:a");
    later();
    later();
    expect(mounted()).toBeNull();
  });
});
