import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runCli } from "./server/cli";
import { updateIfBehind } from "./server/auto-update";
import { renameChat } from "./shared/rename";
import { checkForUpdate } from "./shared/updates";
import { overlaySettings, prefsSettings } from "./shared/settings";

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

  let checking = false;
  const check = async () => {
    if (checking) return;
    checking = true;
    try {
      const state = await prefs.read();
      // An unreadable settings document leaves the default (on).
      if (state.status === "ready" && !state.values.autoUpdate) return;
      console.log(`Recent Chats update check: ${await updateIfBehind()}`);
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
  const first = setTimeout(() => void check(), FIRST_CHECK_MS);
  const every = setInterval(() => void check(), CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
