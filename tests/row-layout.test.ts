import { describe, expect, it } from "vitest";
import { agentLabel, formatAge } from "../client/format";
import {
  columnChars,
  linesOf,
  moveToken,
  normalizeLayout,
  placeToken,
  placeTokenOnNewLine,
  ownLine,
  resetLayout,
  setEnabled,
  setMaxChars,
  sameLayout,
  setMono,
  tokenMono,
  tokenText,
  tokenValue,
  visibleLines,
} from "../client/row-layout";
import type { TriageRow } from "../client/triage";
import { DEFAULT_LAYOUT, MAX_TOKEN_CHARS, type RowToken } from "../shared/layout";

const ids = (tokens: readonly RowToken[]) => tokens.map((token) => token.id);
const tokensOfLine = (layout: readonly RowToken[], line: number) => layout.filter((token) => token.line === line);
const lineCount = (layout: readonly RowToken[]) => linesOf(layout).length;

function row(patch: Partial<TriageRow> = {}): TriageRow {
  return {
    key: "h:a",
    hostId: "h",
    hostLabel: "laptop",
    agentId: "agent-1",
    workspaceId: null,
    projectName: "MultiHostManager",
    workspaceName: "Plan Paseo host plugin",
    branch: "main",
    agentName: "opus-5.5",
    title: "Fix the thing",
    provider: "omp",
    bucket: "unread",
    pinned: false,
    led: "finished",
    released: false,
    failed: false,
    sortAt: 1,
    ...patch,
  };
}

describe("default layout", () => {
  it("is host, light, project, workspace, tab name on line 1 and branch, agent, age (off) on line 2", () => {
    const layout = resetLayout();
    expect(ids(tokensOfLine(layout, 1))).toEqual(["host", "led", "project", "workspace", "title"]);
    expect(ids(tokensOfLine(layout, 2))).toEqual(["branch", "agent", "age"]);
    expect(layout.map((token) => token.maxChars)).toEqual([6, 0, 10, 10, 0, 24, 0, 6]);
    expect(layout.filter((token) => !token.enabled).map((token) => token.id)).toEqual(["age"]);
  });

  it("returns copies, so editing a reset layout never changes the defaults", () => {
    const layout = resetLayout();
    layout[0]!.maxChars = 99;
    expect(DEFAULT_LAYOUT[0]?.maxChars).toBe(6);
  });
});

describe("normalizeLayout", () => {
  it("keeps the first of a repeated token and appends missing ones switched off", () => {
    const stored: RowToken[] = [
      { id: "title", enabled: true, line: 1, maxChars: 0 },
      { id: "title", enabled: false, line: 2, maxChars: 5 },
      { id: "host", enabled: true, line: 1, maxChars: 6 },
    ];
    const layout = normalizeLayout(stored);
    expect(ids(layout)).toEqual(["title", "host", "led", "project", "workspace", "branch", "agent", "age"]);
    expect(layout.find((token) => token.id === "title")?.maxChars).toBe(0);
    expect(layout.filter((token) => !token.enabled).map((token) => token.id)).toEqual([
      "led",
      "project",
      "workspace",
      "branch",
      "agent",
      "age",
    ]);
  });

  it("closes gaps in line numbers and keeps token order inside a line", () => {
    const layout = normalizeLayout([
      { id: "title", enabled: true, line: 5, maxChars: 0 },
      { id: "host", enabled: true, line: 2, maxChars: 6 },
      { id: "led", enabled: true, line: 2, maxChars: 0 },
      { id: "project", enabled: true, line: 9, maxChars: 0 },
      { id: "workspace", enabled: true, line: 9, maxChars: 0 },
      { id: "branch", enabled: true, line: 9, maxChars: 0 },
      { id: "agent", enabled: true, line: 9, maxChars: 0 },
      { id: "age", enabled: false, line: 9, maxChars: 0 },
    ]);
    expect(layout.map((token) => [token.id, token.line])).toEqual([
      ["host", 1],
      ["led", 1],
      ["title", 2],
      ["project", 3],
      ["workspace", 3],
      ["branch", 3],
      ["agent", 3],
      ["age", 3],
    ]);
  });

  it("orders line 1 before line 2 and clamps lengths", () => {
    const layout = normalizeLayout([
      { id: "agent", enabled: true, line: 2, maxChars: 9999 },
      { id: "host", enabled: true, line: 1, maxChars: -4 },
    ]);
    expect(layout[0]).toMatchObject({ id: "host", maxChars: 0 });
    expect(layout.find((token) => token.id === "agent")?.maxChars).toBe(MAX_TOKEN_CHARS);
    const lines = layout.map((token) => token.line);
    expect(lines).toEqual([...lines].sort());
  });
});

describe("editing", () => {
  it("toggles one token without touching the others", () => {
    const next = setEnabled(resetLayout(), "branch", false);
    expect(next.find((token) => token.id === "branch")?.enabled).toBe(false);
    expect(next.filter((token) => token.enabled)).toHaveLength(6);
  });

  it("sets a length and clamps it", () => {
    expect(setMaxChars(resetLayout(), "project", 25).find((t) => t.id === "project")?.maxChars).toBe(25);
    expect(setMaxChars(resetLayout(), "project", 5000).find((t) => t.id === "project")?.maxChars).toBe(MAX_TOKEN_CHARS);
    expect(setMaxChars(resetLayout(), "project", Number.NaN).find((t) => t.id === "project")?.maxChars).toBe(0);
  });

  it("moves a token within its line", () => {
    const down = moveToken(resetLayout(), "host", 1);
    expect(ids(tokensOfLine(down, 1))).toEqual(["led", "host", "project", "workspace", "title"]);
    const up = moveToken(down, "title", -1);
    expect(ids(tokensOfLine(up, 1))).toEqual(["led", "host", "project", "title", "workspace"]);
  });

  it("crosses into the neighbouring line at the edge of a line", () => {
    const down = moveToken(resetLayout(), "title", 1);
    expect(ids(tokensOfLine(down, 1))).toEqual(["host", "led", "project", "workspace"]);
    expect(ids(tokensOfLine(down, 2))).toEqual(["title", "branch", "agent", "age"]);
    const up = moveToken(resetLayout(), "branch", -1);
    expect(ids(tokensOfLine(up, 1))).toEqual(["host", "led", "project", "workspace", "title", "branch"]);
    expect(ids(tokensOfLine(up, 2))).toEqual(["agent", "age"]);
  });

  it("leaves the very first and very last place alone", () => {
    expect(moveToken(resetLayout(), "host", -1)).toEqual(resetLayout());
    expect(moveToken(resetLayout(), "age", 1)).toEqual(resetLayout());
  });

  it("closes a line that becomes empty", () => {
    let layout = moveToken(resetLayout(), "branch", -1);
    layout = moveToken(layout, "agent", -1);
    layout = moveToken(layout, "age", -1);
    expect(lineCount(layout)).toBe(1);
    expect(new Set(layout.map((token) => token.line))).toEqual(new Set([1]));
  });

  it("places a token into any line at any position", () => {
    const layout = placeToken(resetLayout(), "title", 2, 1);
    expect(ids(tokensOfLine(layout, 1))).toEqual(["host", "led", "project", "workspace"]);
    expect(ids(tokensOfLine(layout, 2))).toEqual(["branch", "title", "agent", "age"]);
  });

  it("dropping a token where it already is changes nothing", () => {
    expect(placeToken(resetLayout(), "project", 1, 2)).toEqual(resetLayout());
  });

  it("clamps the position and treats a line past the end as a new line", () => {
    expect(ids(tokensOfLine(placeToken(resetLayout(), "host", 2, 99), 2))).toEqual(["branch", "agent", "age", "host"]);
    const added = placeToken(resetLayout(), "host", 9, 0);
    expect(lineCount(added)).toBe(3);
    expect(ids(tokensOfLine(added, 3))).toEqual(["host"]);
  });

  it("has no limit on the number of lines", () => {
    let layout = resetLayout();
    for (const id of ["host", "led", "project", "workspace", "title", "branch"] as const) {
      layout = placeTokenOnNewLine(layout, id, lineCount(layout) + 1);
    }
    expect(lineCount(layout)).toBe(7);
    expect(visibleLines(layout)).toHaveLength(7);
    expect(ids(layout)).toEqual(["agent", "age", "host", "led", "project", "workspace", "title", "branch"]);
  });

  it("puts a token on a new line at a chosen position", () => {
    const top = placeTokenOnNewLine(resetLayout(), "title", 1);
    expect(ids(tokensOfLine(top, 1))).toEqual(["title"]);
    expect(ids(tokensOfLine(top, 2))).toEqual(["host", "led", "project", "workspace"]);
    expect(lineCount(top)).toBe(3);
  });

  it("gives a token a line of its own under its line, and ignores a token that is alone", () => {
    const split = ownLine(resetLayout(), "workspace");
    expect(ids(tokensOfLine(split, 1))).toEqual(["host", "led", "project", "title"]);
    expect(ids(tokensOfLine(split, 2))).toEqual(["workspace"]);
    expect(ids(tokensOfLine(split, 3))).toEqual(["branch", "agent", "age"]);
    const alone = placeTokenOnNewLine(resetLayout(), "agent", 3);
    expect(ownLine(alone, "agent")).toEqual(alone);
  });

  it("ignores unknown ids", () => {
    expect(placeToken([], "host", 1, 0)).toEqual([]);
    expect(placeTokenOnNewLine([], "host", 1)).toEqual([]);
  });

  it("visibleLines leaves out switched-off tokens and lines with nothing on", () => {
    const layout = setEnabled(setEnabled(resetLayout(), "led", false), "agent", false);
    expect(visibleLines(layout).map(ids)).toEqual([["host", "project", "workspace", "title"], ["branch"]]);
    const noSecond = setEnabled(setEnabled(resetLayout(), "branch", false), "agent", false);
    expect(visibleLines(noSecond)).toHaveLength(1);
  });
});

describe("what a row shows", () => {
  const layout = resetLayout();
  const token = (id: RowToken["id"]) => layout.find((t) => t.id === id)!;

  it("cuts capped tokens with an ellipsis and shows unlimited ones in full", () => {
    expect(tokenText(row(), token("project"))).toBe("MultiHost\u2026");
    expect(tokenText(row(), token("workspace"))).toBe("Plan Pase\u2026");
    expect(tokenText(row(), token("title"))).toBe("Fix the thing");
    expect(tokenText(row({ title: "x".repeat(300) }), token("title"))).toHaveLength(300);
  });

  it("honours a custom length", () => {
    const wide = setMaxChars(layout, "project", 25).find((t) => t.id === "project")!;
    expect(tokenText(row(), wide)).toBe("MultiHostManager");
  });

  it("falls back for untitled chats and unknown models", () => {
    expect(tokenText(row({ title: null }), token("title"))).toBe("omp agent-");
    expect(agentLabel("vendor/claude/opus-5.5", "omp")).toBe("opus-5.5");
    expect(agentLabel("opus", "omp")).toBe("opus");
    expect(agentLabel(null, "omp")).toBe("omp");
    expect(agentLabel("", "omp")).toBe("omp");
  });
});

describe("columnChars", () => {
  const layout = resetLayout();

  it("sizes each capped column to its longest cut value, never above the cap", () => {
    const widths = columnChars(
      [row({ projectName: "abc", workspaceName: "x".repeat(30) }), row({ projectName: "abcdef" })],
      layout,
    );
    expect(widths.project).toBe(6);
    expect(widths.workspace).toBe(10);
    expect(widths.host).toBe(6);
  });

  it("leaves unlimited tokens and the light out so they flex", () => {
    const widths = columnChars([row()], layout);
    expect(widths.title).toBeUndefined();
    expect(widths.agent).toBeUndefined();
    expect(widths.led).toBeUndefined();
  });

  it("gives an all-empty column width 0 so it can be left out", () => {
    expect(columnChars([row({ branch: "" }), row({ branch: "" })], layout).branch).toBe(0);
  });

  it("ignores switched-off tokens", () => {
    expect(columnChars([row()], setEnabled(layout, "project", false)).project).toBeUndefined();
  });
});

describe("monospace option", () => {
  it("defaults to monospace for workspace and branch only, so the project is proportional", () => {
    const mono = Object.fromEntries(resetLayout().map((token) => [token.id, tokenMono(token)]));
    expect(mono).toEqual({ host: false, led: false, project: false, workspace: true, title: false, branch: true, agent: false, age: true });
  });

  it("falls back to the item's default for layouts saved before the option existed", () => {
    expect(tokenMono({ id: "project", enabled: true, line: 1, maxChars: 10 })).toBe(false);
    expect(tokenMono({ id: "branch", enabled: true, line: 2, maxChars: 24 })).toBe(true);
    const old = normalizeLayout([{ id: "workspace", enabled: true, line: 1, maxChars: 10 }]);
    expect(old.find((token) => token.id === "workspace")?.mono).toBe(true);
    expect(old.find((token) => token.id === "title")?.mono).toBe(false);
  });

  it("an explicit choice wins and survives moving and normalising", () => {
    let layout = setMono(resetLayout(), "title", true);
    layout = setMono(layout, "workspace", false);
    layout = normalizeLayout(moveToken(layout, "title", 1));
    expect(tokenMono(layout.find((token) => token.id === "title")!)).toBe(true);
    expect(tokenMono(layout.find((token) => token.id === "workspace")!)).toBe(false);
  });
});

describe("sameLayout", () => {
  it("is true for equal layouts whatever the key order or an unset mono", () => {
    const a: RowToken[] = [{ id: "branch", enabled: true, line: 1, maxChars: 24 }];
    const b: RowToken[] = [{ mono: true, maxChars: 24, line: 1, enabled: true, id: "branch" }];
    expect(sameLayout(a, b)).toBe(true);
    expect(sameLayout(resetLayout(), resetLayout())).toBe(true);
  });

  it("notices every kind of change", () => {
    const base = resetLayout();
    expect(sameLayout(base, setEnabled(base, "host", false))).toBe(false);
    expect(sameLayout(base, setMaxChars(base, "host", 7))).toBe(false);
    expect(sameLayout(base, setMono(base, "title", true))).toBe(false);
    expect(sameLayout(base, moveToken(base, "host", 1))).toBe(false);
    expect(sameLayout(base, base.slice(1))).toBe(false);
  });
});

describe("age", () => {
  it("shows how long ago the section's time was, in the largest whole unit", () => {
    expect(formatAge(20_000)).toBe("now");
    expect(formatAge(5 * 60_000)).toBe("5m");
    expect(formatAge(3 * 3_600_000 + 59 * 60_000)).toBe("3h");
    expect(formatAge(2 * 86_400_000)).toBe("2d");
    expect(formatAge(20 * 86_400_000)).toBe("2w");
    expect(formatAge(400 * 86_400_000)).toBe("1y");
  });

  it("is the age of the time the row sorts on", () => {
    expect(tokenValue(row({ sortAt: Date.now() - 90 * 60_000 }), "age")).toBe("1h");
  });
});
