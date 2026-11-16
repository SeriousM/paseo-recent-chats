// Follows one host's agents and workspaces through owned subscriptions.
// Pattern from the Workspace Navigator plugin: paginate the snapshot, buffer live updates
// while a snapshot loads, replace state on every reconnect snapshot. No classes (Hermes).
import type {
  OwnedSubscription,
  PaseoAgent,
  PaseoAgentListResult,
  PaseoApi,
  PaseoProject,
  PaseoWorkspace,
  PaseoWorkspaceListResult,
  SessionOutboundMessage,
} from "./paseo-types";

const PAGE_SIZE = 200;
const MAX_PAGES = 100;

export interface HostData {
  agents: PaseoAgent[];
  workspaces: PaseoWorkspace[];
  /** Every project the host knows, also those without a workspace. Empty where the app has no project list. */
  projects: PaseoProject[];
  loading: boolean;
  error: string | null;
}

export interface HostObserver {
  start(): void;
  stop(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createHostObserver(api: PaseoApi, publish: (data: HostData) => void): HostObserver {
  let stopped = false;
  let cleanups: (() => void)[] = [];
  let agents = new Map<string, PaseoAgent>();
  let workspaces = new Map<string, PaseoWorkspace>();
  let projects = new Map<string, PaseoProject>();
  const pending = new Set(["agents", "workspaces"]);
  const failures = new Map<string, string>();

  function emit() {
    if (stopped) return;
    publish({
      agents: [...agents.values()],
      workspaces: [...workspaces.values()],
      projects: [...projects.values()],
      loading: pending.size > 0,
      error: failures.size ? [...failures.values()].join("; ") : null,
    });
  }

  function fail(name: string, error: unknown) {
    pending.delete(name);
    failures.set(name, `${name}: ${message(error)}`);
    emit();
  }

  function track(subscription: Pick<OwnedSubscription<unknown>, "release">) {
    const release = () => {
      void subscription.release().catch(() => {});
    };
    if (stopped) release();
    else cleanups.push(release);
  }

  async function startDirectory<
    T,
    Result extends { pageInfo: { nextCursor: string | null; hasMore: boolean } },
  >(options: {
    name: string;
    list(): Promise<Result & { subscription: OwnedSubscription<Result> }>;
    page(cursor: string): Promise<Result>;
    entries(result: Result): T[];
    key(item: T): string;
    replace(items: Map<string, T>): void;
    update(event: SessionOutboundMessage, items: Map<string, T>): void;
  }): Promise<void> {
    let generation = 0;
    let loading = false;
    let items = new Map<string, T>();
    let buffered: SessionOutboundMessage[] = [];
    try {
      const first = await options.list();
      track(first.subscription);
      if (stopped) return;
      cleanups.push(
        first.subscription.subscribe({
          snapshot: (snapshot) => {
            const current = ++generation;
            loading = true;
            buffered = [];
            pending.add(options.name);
            void (async () => {
              const next = new Map(options.entries(snapshot).map((item) => [options.key(item), item]));
              let page: Result = snapshot;
              const seen = new Set<string>();
              for (let count = 1; page.pageInfo.hasMore; count++) {
                const cursor = page.pageInfo.nextCursor;
                if (!cursor || seen.has(cursor) || count >= MAX_PAGES)
                  throw new Error(`${options.name}: directory is incomplete`);
                seen.add(cursor);
                page = await options.page(cursor);
                if (stopped || current !== generation) return;
                for (const item of options.entries(page)) next.set(options.key(item), item);
              }
              if (stopped || current !== generation) return;
              for (const event of buffered) options.update(event, next);
              buffered = [];
              loading = false;
              items = next;
              options.replace(items);
              pending.delete(options.name);
              failures.delete(options.name);
              emit();
            })().catch((error) => {
              if (stopped || current !== generation) return;
              loading = false;
              buffered = [];
              fail(options.name, error);
            });
          },
          update: (event) => {
            if (loading) buffered.push(event);
            else {
              options.update(event, items);
              options.replace(items);
              emit();
            }
          },
          error: (error) => fail(options.name, error),
        }),
      );
    } catch (error) {
      fail(options.name, error);
    }
  }

  /** The project list: read once, then kept current from project updates. Optional: older apps lack it. */
  async function startProjects(): Promise<void> {
    const actions = (api as Partial<PaseoApi>).projects;
    if (typeof actions?.list !== "function" || typeof actions.subscribe !== "function") return;
    cleanups.push(
      actions.subscribe((update) => {
        if (update.kind === "upsert") projects.set(update.project.projectId, update.project);
        else projects.delete(update.projectId);
        emit();
      }),
    );
    try {
      const result = await actions.list();
      if (stopped) return;
      projects = new Map(result.projects.map((project) => [project.projectId, project]));
      emit();
    } catch (error) {
      // Without the list only projects that have a workspace show; chats are unaffected.
      console.warn(`Recent Chats: project list failed: ${message(error)}`);
    }
  }

  return {
    start() {
      void startProjects();
      void startDirectory<PaseoWorkspace, PaseoWorkspaceListResult>({
        name: "workspaces",
        list: () => api.workspaces.list({ page: { limit: PAGE_SIZE }, subscribe: {} }),
        page: (cursor) => api.workspaces.list({ page: { limit: PAGE_SIZE, cursor } }),
        entries: (result) => result.entries,
        key: (workspace) => workspace.id,
        replace: (items) => {
          workspaces = items;
        },
        update: (event, items) => {
          if (event.type !== "workspace_update") return;
          if (event.payload.kind === "upsert") items.set(event.payload.workspace.id, event.payload.workspace);
          else items.delete(event.payload.id);
        },
      });
      void startDirectory<PaseoAgent, PaseoAgentListResult>({
        name: "agents",
        list: () =>
          api.agents.list({
            filter: { includeArchived: false },
            sort: [{ key: "updated_at", direction: "desc" }],
            page: { limit: PAGE_SIZE },
            subscribe: {},
          }),
        page: (cursor) =>
          api.agents.list({
            filter: { includeArchived: false },
            sort: [{ key: "updated_at", direction: "desc" }],
            page: { limit: PAGE_SIZE, cursor },
          }),
        entries: (result) => result.entries.map((entry) => entry.agent),
        key: (agent) => agent.id,
        replace: (items) => {
          agents = items;
        },
        update: (event, items) => {
          if (event.type !== "agent_update") return;
          const update = event.payload;
          if (update.kind === "upsert" && !update.agent.archivedAt) items.set(update.agent.id, update.agent);
          else items.delete(update.kind === "remove" ? update.agentId : update.agent.id);
        },
      });
    },
    stop() {
      stopped = true;
      for (const cleanup of cleanups.reverse()) cleanup();
      cleanups = [];
    },
  };
}
