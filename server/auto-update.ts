// Keeps this installation on the newest commit of its Git source, through the host's own
// `paseo plugin update`. The update stops and reloads this plugin while it installs, so the installing
// run is started detached. A failed build keeps the installed version (Paseo's own guarantee).
import { runCli, startCliDetached } from "./cli";

/** The repository this plugin is published from; installations from elsewhere (a local folder) are left alone. */
const SOURCE = "github.com/seriousm/paseo-recent-chats";

interface Listed {
  id: string;
  remote?: string;
}

interface CheckResult {
  id: string;
  outcome: string;
  target?: { commit?: string };
}

/** Checks once and starts the update when a newer commit exists. Resolves to what happened, for the log. */
export async function updateIfBehind(): Promise<string> {
  const listed = JSON.parse(await runCli(["plugin", "ls", "--json"])) as Listed[];
  const ids = listed.filter((entry) => entry.remote?.toLowerCase().includes(SOURCE)).map((entry) => entry.id);
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
