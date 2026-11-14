import { describe, expect, it } from "vitest";
import { fullArgs } from "../server/cli";

describe("CLI arguments", () => {
  it("puts --home before a -- separator, so it is not read as part of the title", () => {
    expect(fullArgs([], ["workspace", "rename", "wks_1", "--", "-draft"], "/home/p/.paseo")).toEqual([
      "workspace",
      "rename",
      "wks_1",
      "--home",
      "/home/p/.paseo",
      "--",
      "-draft",
    ]);
  });

  it("appends --home at the end without a separator, and leaves it out without a home", () => {
    expect(fullArgs(["entry.js"], ["agent", "update", "a", "--name=x"], "/h")).toEqual(["entry.js", "agent", "update", "a", "--name=x", "--home", "/h"]);
    expect(fullArgs([], ["workspace", "rename", "w", "--", "t"], undefined)).toEqual(["workspace", "rename", "w", "--", "t"]);
  });
});
