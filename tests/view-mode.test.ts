import { describe, expect, it, vi } from "vitest";

vi.mock("../client/web", () => ({ readDeviceValue: () => null, writeDeviceValue: () => {} }));

describe("device view state after an update", () => {
  it("ignores what an earlier version left in the app under the old key", async () => {
    // The trial build kept { view, activeOnly, pins, toggled, groupHosts } here; the app keeps it across a reload.
    (globalThis as Record<string, unknown>)["__paseoRecentChats.viewMode.v1"] = {
      value: { view: "projects", activeOnly: true, pins: ["project:h1:x"], toggled: [], groupHosts: true },
      listeners: new Set(),
    };
    const { currentViewMode, resolvedView } = await import("../client/view-mode");
    const mode = currentViewMode();
    expect(mode.legacyPins).toEqual([]);
    expect(mode.toggled).toEqual([]);
    expect(resolvedView(mode, false)).toBe("projects");
    expect(resolvedView(mode, true)).toBe("triage");
  });
});
