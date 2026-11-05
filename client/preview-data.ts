// Sample rows for the settings preview. Invented names only, never data from a real host. The values are long on
// purpose, so the effect of each cut and of each line is visible.
import type { TriageRow } from "./triage";

export const PREVIEW_HOST_COLORS: Readonly<Record<string, string>> = {
  "preview-laptop": "violet",
  "preview-buildbox": "teal",
};

const base = { workspaceId: null, provider: "omp" } as const;

export const PREVIEW_ROWS: readonly TriageRow[] = [
  {
    ...base,
    key: "preview-laptop:1",
    hostId: "preview-laptop",
    hostLabel: "laptop",
    agentId: "preview-1",
    projectName: "Acme Storefront",
    workspaceName: "Checkout redesign",
    branch: "feature/checkout-redesign-cart-summary",
    agentName: "opus-5.5",
    title: "Fix cart total rounding and add regression tests",
    bucket: "unread",
    pinned: false,
    led: "permission",
    sortAt: 3,
  },
  {
    ...base,
    key: "preview-buildbox:2",
    hostId: "preview-buildbox",
    hostLabel: "buildbox-eu",
    agentId: "preview-2",
    projectName: "Billing Service",
    workspaceName: "Invoice export",
    branch: "task-4821-export-invoices-as-csv-with-locale-dates",
    agentName: "sonnet-5-5",
    title: "Export invoices as CSV with locale-aware dates",
    bucket: "running",
    pinned: false,
    led: "running",
    sortAt: 2,
  },
  {
    ...base,
    key: "preview-laptop:3",
    hostId: "preview-laptop",
    hostLabel: "laptop",
    agentId: "preview-3",
    projectName: "Docs Site",
    workspaceName: "Typo sweep",
    branch: "main",
    agentName: "sonnet-5-5",
    title: "Update the contributing guide",
    bucket: "inactive",
    pinned: true,
    led: "idle",
    sortAt: 1,
  },
];
