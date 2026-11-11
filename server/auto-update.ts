// Keeps this installation on the newest commit of its Git source, through the host's own
// `paseo plugin update`. The update stops and reloads this plugin while it installs, so the installing
// run is started detached. A failed build keeps the installed version (Paseo's own guarantee).
import { stat } from "node:fs/promises";
import { dirname, sep } from "node:path";
import { runCli, startCliDetached } from "./cli";

/** The repository this plugin is published from; installations from elsewhere (a local folder) are left alone. */
const SOURCE = "github.com/seriousm/paseo-recent-chats";

interface Listed {
  id: string;
  path: string;
  remote?: string;
  commit?: string;
}

interface CheckResult {
  id: string;
  outcome: string;
  target?: { commit?: string };
}

export interface InstalledVersion {
  commit: string;
  /** When this commit was installed (ms). Every update installs into a new folder, so this orders versions. */
  installedAt: number;
}

async function ownInstallations(): Promise<Listed[]> {
  const listed = JSON.parse(await runCli(["plugin", "ls", "--json"])) as Listed[];
  return listed.filter((entry) => entry.remote?.toLowerCase().includes(SOURCE));
}

/** `<home>/plugins/<id>/<install folder>/…`: the install folder is created by the install. */
function installFolder(entry: Listed): string {
  const parts = entry.path.split(/[\\/]/);
  const at = parts.findIndex((part, index) => part === "plugins" && parts[index + 1] === entry.id);
  return at === -1 || !parts[at + 2] ? dirname(entry.path) : parts.slice(0, at + 3).join(sep);
}

/** The version installed from GitHub on this host, or null for a local folder install. */
export async function installedVersion(): Promise<InstalledVersion | null> {
  const [own] = await ownInstallations();
  if (!own?.commit) return null;
  return { commit: own.commit, installedAt: Math.round((await stat(installFolder(own))).mtimeMs) };
}

/** Checks once and starts the update when a newer commit exists. Resolves to what happened, for the log. */
export async function updateIfBehind(): Promise<string> {
  const ids = (await ownInstallations()).map((entry) => entry.id);
  if (!ids.length) return "not installed from GitHub; nothing to update";
  const notes: string[] = [];
  for (const id of ids) {
    const [check] = JSON.parse(await runCli(["plugin", "update", id, "--check", "--json"])) as CheckResult[];
    if (check?.outcome !== "update") {
      notes.push(`${id}: up to date`);
      continue;
    }
    startCliDetached(["plugin", "update", id, "--yes"]);
    notes.push(`${id}: updating to ${check.target?.commit?.slice(0, 7) ?? "the newest commit"}`);
  }
  return notes.join("; ");
}
