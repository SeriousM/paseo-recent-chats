// Keeps this installation on the newest commit of its Git source. Paseo has no update API for plugins,
// so this runs the host's own `paseo plugin update` CLI, the same command a person would type. The CLI
// stops and reloads this plugin while it installs, so the installing run is started detached and
// outlives this process. A failed build keeps the installed version (Paseo's own guarantee).
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** The repository this plugin is published from; installations from elsewhere (a local folder) are left alone. */
const SOURCE = "github.com/seriousm/paseo-recent-chats";
const CHECK_TIMEOUT_MS = 120_000;

interface Listed {
  id: string;
  remote?: string;
}

interface CheckResult {
  id: string;
  outcome: string;
  target?: { commit?: string };
}

/**
 * The `paseo` CLI of this host. The desktop app runs plugins with its own executable and ships the CLI
 * in resources/bin; an npm install puts `paseo` next to node or on PATH.
 */
function findCli(): string {
  const exe = process.platform === "win32" ? "paseo.cmd" : "paseo";
  const home = dirname(process.execPath);
  for (const candidate of [join(home, "resources", "bin", exe), join(home, exe)]) {
    if (existsSync(candidate)) return candidate;
  }
  return exe;
}

/** Arguments are fixed words and plugin ids from the CLI's own listing, so the shell sees no user input. */
function command(cli: string, args: readonly string[]): string {
  const home = process.env.PASEO_HOME ? ["--home", `"${process.env.PASEO_HOME}"`] : [];
  return [`"${cli}"`, ...args, ...home].join(" ");
}

async function run(cli: string, args: readonly string[]): Promise<string> {
  // A shell is needed on Windows, where the CLI is a .cmd script.
  const { stdout } = await execFileAsync(command(cli, args), { shell: true, timeout: CHECK_TIMEOUT_MS, windowsHide: true });
  return stdout;
}

/** Ids of the installations of this plugin that follow its Git repository. */
async function ownInstallations(cli: string): Promise<string[]> {
  const listed = JSON.parse(await run(cli, ["plugin", "ls", "--json"])) as Listed[];
  return listed.filter((entry) => entry.remote?.toLowerCase().includes(SOURCE)).map((entry) => entry.id);
}

/** Checks once and starts the update when a newer commit exists. Resolves to what happened, for the log. */
export async function updateIfBehind(): Promise<string> {
  const cli = findCli();
  const ids = await ownInstallations(cli);
  if (!ids.length) return "not installed from GitHub; nothing to update";
  const notes: string[] = [];
  for (const id of ids) {
    if (!/^[\w.-]+$/.test(id)) continue;
    const [check] = JSON.parse(await run(cli, ["plugin", "update", id, "--check", "--json"])) as CheckResult[];
    if (check?.outcome !== "update") {
      notes.push(`${id}: up to date`);
      continue;
    }
    // Detached: the update reloads this plugin, which ends this process before the CLI is done.
    const child = spawn(command(cli, ["plugin", "update", id, "--yes"]), {
      shell: true,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.unref();
    notes.push(`${id}: updating to ${check.target?.commit?.slice(0, 7) ?? "the newest commit"}`);
  }
  return notes.join("; ");
}
