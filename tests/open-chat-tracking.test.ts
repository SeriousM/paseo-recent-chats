import { describe, expect, it } from "vitest";
import { currentOpenChat, reportOpenChat } from "../client/open-chat";

describe("open chat tracking", () => {
  it("takes the newest shown chat, and falls back to the one below when it goes (phone stack)", () => {
    const first = reportOpenChat("h1:a");
    const second = reportOpenChat("h2:b");
    expect(currentOpenChat()).toBe("h2:b");
    second.remove();
    expect(currentOpenChat()).toBe("h1:a");
    first.remove();
    expect(currentOpenChat()).toBeNull();
  });

  it("follows a desktop tab switch back to a chat that stayed mounted in the background", () => {
    const older = reportOpenChat("h1:a");
    const newer = reportOpenChat("h1:b");
    // Switching back to tab a: b's tab is hidden, a's is shown again.
    newer.setVisible(false);
    older.setVisible(false);
    older.setVisible(true);
    expect(currentOpenChat()).toBe("h1:a");
    // And to b again.
    older.setVisible(false);
    newer.setVisible(true);
    expect(currentOpenChat()).toBe("h1:b");
    older.remove();
    newer.remove();
  });

  it("keeps a chat open while another icon of the same chat is still shown", () => {
    const inbox = reportOpenChat("h1:a");
    const later = reportOpenChat("h1:a");
    inbox.remove();
    expect(currentOpenChat()).toBe("h1:a");
    later.remove();
    later.remove();
    expect(currentOpenChat()).toBeNull();
  });
});
