import type { getPaseoClient } from "@getpaseo/plugin/client";

// Named types for the Paseo SDK, derived from the plugin SDK the host provides. Importing them from
// "@getpaseo/client" or "@getpaseo/protocol" would fail when Paseo compiles a plugin installed from Git,
// because dev dependencies are not installed in that checkout. The derivation is confined to this file.

/** The Paseo API a plugin gets for one host. */
export type PaseoApi = ReturnType<typeof getPaseoClient>;

export type PaseoAgentListResult = Awaited<ReturnType<PaseoApi["agents"]["list"]>>;
export type PaseoWorkspaceListResult = Awaited<ReturnType<PaseoApi["workspaces"]["list"]>>;

/** One chat as the daemon describes it. */
export type PaseoAgent = PaseoAgentListResult["entries"][number]["agent"];
/** One workspace as the daemon describes it. */
export type PaseoWorkspace = PaseoWorkspaceListResult["entries"][number];

type EventSubscription = ReturnType<PaseoApi["observeEvents"]>;
type EventObserver = Parameters<EventSubscription["subscribe"]>[0];

/** A live update message from a directory subscription. */
export type SessionOutboundMessage = Parameters<EventObserver["update"]>[0];

/** A subscription this plugin owns and must release. */
export type OwnedSubscription<T> = Omit<EventSubscription, "ready" | "subscribe"> & {
  readonly ready: Promise<T & { subscriptionId: string }>;
  subscribe(observer: {
    snapshot(value: T & { subscriptionId: string }): void;
    update(event: SessionOutboundMessage): void;
    error?(error: unknown): void;
  }): () => void;
};
