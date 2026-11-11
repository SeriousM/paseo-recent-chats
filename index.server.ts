import type { PluginServerContext } from "@getpaseo/plugin/server";
import { updateIfBehind } from "./server/auto-update";
import { overlaySettings, prefsSettings } from "./shared/settings";

/** First check a little after start, so a host that just started is not slowed down; then every few hours. */
const FIRST_CHECK_MS = 2 * 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

// The settings documents, and the update check that keeps this host on the newest version.
export default function contribute(server: PluginServerContext) {
  const prefs = server.registerSettings(prefsSettings);
  server.registerSettings(overlaySettings);

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
  const first = setTimeout(() => void check(), FIRST_CHECK_MS);
  const every = setInterval(() => void check(), CHECK_EVERY_MS);
  return () => {
    clearTimeout(first);
    clearInterval(every);
  };
}
