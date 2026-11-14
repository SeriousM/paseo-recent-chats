// Sample rows for the settings previews. Invented names only, never data from a real host. The values are long on
// purpose, so the effect of each cut and of each line is visible.
import type { WorkspaceInfo } from "./store";
import type { TriageRow } from "./triage";

export const PREVIEW_HOST_COLORS: Readonly<Record<string, string>> = {
  "preview-laptop": "violet",
  "preview-buildbox": "teal",
};

const MIN = 60_000;
const now = Date.now();
const base = { provider: "omp", released: false, failed: false } as const;

/** Three chats in three states, for the row layout and Triage previews. */
export const PREVIEW_ROWS: readonly TriageRow[] = [
  {
    ...base,
    key: "preview-laptop:1",
    hostId: "preview-laptop",
    hostLabel: "laptop",
    agentId: "preview-1",
    workspaceId: "checkout",
    projectName: "Acme Storefront",
    workspaceName: "Checkout redesign",
    branch: "feature/checkout-redesign-cart-summary",
    agentName: "opus-5.5",
    provider: "claude",
    title: "Fix cart total rounding and add regression tests",
    bucket: "unread",
    pinned: false,
    led: "permission",
    sortAt: now - 4 * MIN,
  },
  {
    ...base,
    key: "preview-buildbox:2",
    hostId: "preview-buildbox",
    hostLabel: "buildbox-eu",
    agentId: "preview-2",
    workspaceId: "invoices",
    projectName: "Billing Service",
    workspaceName: "Invoice export",
    branch: "task-4821-export-invoices-as-csv-with-locale-dates",
    agentName: "sonnet-5-5",
    title: "Export invoices as CSV with locale-aware dates",
    bucket: "running",
    pinned: false,
    led: "running",
    sortAt: now - 12 * MIN,
  },
  {
    ...base,
    key: "preview-laptop:3",
    hostId: "preview-laptop",
    hostLabel: "laptop",
    agentId: "preview-3",
    workspaceId: "typos",
    projectName: "Docs Site",
    workspaceName: "Typo sweep",
    branch: "main",
    agentName: "sonnet-5-5",
    title: "Update the contributing guide",
    bucket: "inactive",
    pinned: true,
    led: "idle",
    released: true,
    sortAt: now - 3 * 24 * 60 * MIN,
  },
];

/** The same chats plus older ones in the first workspace, so "+N older" shows in the Projects preview. */
export const PREVIEW_TREE_ROWS: readonly TriageRow[] = [
  ...PREVIEW_ROWS,
  ...["Sketch the new cart summary", "Review the checkout copy", "Measure the checkout bundle size"].map(
    (title, index): TriageRow => ({
      ...base,
      key: `preview-laptop:old-${index}`,
      hostId: "preview-laptop",
      hostLabel: "laptop",
      agentId: `preview-old-${index}`,
      workspaceId: "checkout",
      projectName: "Acme Storefront",
      workspaceName: "Checkout redesign",
      branch: "feature/checkout-redesign-cart-summary",
      agentName: "opus-5.5",
      provider: "claude",
      title,
      bucket: "inactive",
      pinned: false,
      led: "idle",
      released: index > 0,
      sortAt: now - (index + 1) * 26 * 60 * MIN,
    }),
  ),
];

const workspace = (hostId: string, id: string, projectName: string, title: string, kind: WorkspaceInfo["kind"], branch: string, diff: WorkspaceInfo["diff"]): WorkspaceInfo => ({
  hostId,
  hostLabel: hostId === "preview-laptop" ? "laptop" : "buildbox-eu",
  id,
  projectId: projectName,
  projectName,
  title,
  kind,
  branch,
  diff,
});

/** Workspace details for the Projects preview, by `${hostId}:${workspaceId}`. */
export const PREVIEW_WORKSPACES: ReadonlyMap<string, WorkspaceInfo> = new Map(
  [
    workspace("preview-laptop", "checkout", "Acme Storefront", "Checkout redesign", "worktree", "feature/checkout-redesign-cart-summary", { additions: 214, deletions: 37 }),
    workspace("preview-buildbox", "invoices", "Billing Service", "Invoice export", "checkout", "task-4821-export-invoices-as-csv-with-locale-dates", null),
    workspace("preview-laptop", "typos", "Docs Site", "Typo sweep", "checkout", "main", { additions: 12, deletions: 9 }),
  ].map((info) => [`${info.hostId}:${info.id}`, info]),
);
