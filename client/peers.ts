// Every connected host runs its own copy of this plugin inside the same app, each with its own modules
// and its own RPC to its host. The copies find each other through one object on globalThis, so the
// copy that renders the sidebar can read and write the settings documents of every other host.
// The Paseo SDK has no cross-host plugin RPC; this is the bridge. Copies of different plugin versions
// share it, so the shape below is a contract: change it only together with DIRECTORY_KEY.
import type { Rpc } from "./store";

const DIRECTORY_KEY = "__paseoRecentChats.peers.v1";

export type PeerChange = "overlay" | "prefs" | "peers";

export interface Peer {
  serverId: string;
  rpc: Rpc;
}

interface SharedDirectory {
  peers: Map<string, Peer>;
  listeners: Set<(change: PeerChange, origin: object | null) => void>;
}

export interface PeerDirectory {
  /** Adds this host's copy. The returned function removes it again (only if it is still the registered one). */
  register(peer: Peer): () => void;
  get(serverId: string): Peer | undefined;
  list(): Peer[];
  /** Tells the other copies that a document changed. `origin` is skipped so a store does not re-read its own write. */
  notify(change: PeerChange, origin: object): void;
  subscribe(listener: (change: PeerChange, origin: object | null) => void): () => void;
}

export function createPeerDirectory(scope: object = globalThis): PeerDirectory {
  const holder = scope as Record<string, SharedDirectory | undefined>;
  const shared = (holder[DIRECTORY_KEY] ??= { peers: new Map(), listeners: new Set() });
  const broadcast = (change: PeerChange, origin: object | null) => {
    for (const listener of [...shared.listeners]) {
      try {
        listener(change, origin);
      } catch {
        // One copy's failing listener must not keep the others from hearing about the change.
      }
    }
  };
  return {
    register(peer) {
      shared.peers.set(peer.serverId, peer);
      broadcast("peers", null);
      return () => {
        if (shared.peers.get(peer.serverId) !== peer) return;
        shared.peers.delete(peer.serverId);
        broadcast("peers", null);
      };
    },
    get: (serverId) => shared.peers.get(serverId),
    list: () => [...shared.peers.values()],
    notify: broadcast,
    subscribe(listener) {
      shared.listeners.add(listener);
      return () => void shared.listeners.delete(listener);
    },
  };
}
