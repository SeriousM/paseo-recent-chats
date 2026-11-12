import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runCli } from "./server/cli";
import { installedVersion, updateIfBehind, type InstalledVersion } from "./server/auto-update";
import { renameChat, renameWorkspace } from "./shared/rename";
import { checkForUpdate, installedVersionRpc } from "./shared/updates";
import { overlaySettings, prefsSettings, type Prefs } from "./shared/settings";

/** First check a little after start, so a host that just started is not slowed down; then every few hours. */
const FIRST_CHECK_MS = 2 * 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

// The settings documents, and the update check that keeps this host on the newest version.
export default function contribute(server: PluginServerContext) {
  const prefs = server.registerSettings(prefsSettings);
  server.registerSettings(overlaySettings);
  // `--name=` keeps a title that starts with a dash from being read as an option.
  server.handle(renameChat, async ({ agentId, title }) => {
    await runCli(["agent", "update", agentId, `--name=${title}`]);
    return { title };
  });
  // `--` keeps a title that starts with a dash from being read as an option.
  server.handle(renameWorkspace, async ({ workspaceId, title }) => {
    await runCli(["workspace", "rename", workspaceId, "--", title]);
    return { title };
  });

  let checking = false;
  const check = async (reason: string) => {
    if (checking) return;
    checking = true;
    try {
      const state = await prefs.read();
      // An unreadable settings document leaves the default (on).
      if (state.status === "ready" && !state.values.autoUpdate) return;
      console.log(`Recent Chats update check (${reason}): ${await updateIfBehind()}`);
    } catch (error) {
      console.error("Recent Chats update check failed", error);
    } finally {
      checking = false;
    }
  };
  // "Check now" in the settings: runs whether or not the scheduled checks are switched on.
  server.handle(checkForUpdate, async () => {
    const result = await updateIfBehind();
    console.log(`Recent Chats update check (asked from the settings): ${result}`);
    return { result };
  });

  // This host's version, for the app to record the newest one in the synced settings. It only changes
  // with an update, which restarts this process, so it is looked up once.
  const own: Promise<InstalledVersion | null> = installedVersion().catch((error: unknown) => {
    console.error("Recent Chats: reading the installed version failed", error);
    return null;
  });
  server.handle(installedVersionRpc, () => own);

  // A host somewhere installed a newer version: check GitHub now instead of at the next scheduled check.
  let followed: string | null = null;
  const follow = async (latest: Prefs["latestVersion"]) => {
    const mine = await own;
    if (!latest || !mine || latest.commit === mine.commit || latest.installedAt <= mine.installedAt) return;
    if (followed === latest.commit) return;
    followed = latest.commit;
    await check(`another host has ${latest.commit.slice(0, 7)}`);
  };
  const unsubscribe = prefs.subscribe((state) => (state.status === "ready" ? follow(state.values.latestVersion) : undefined));
  void prefs.read().then((state) => (state.status === "ready" ? follow(state.values.latestVersion) : undefined));

  const first = setTimeout(() => void check("after start"), FIRST_CHECK_MS);
  const every = setInterval(() => void check("scheduled"), CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
    unsubscribe();
  };
}
