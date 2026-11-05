import type { PluginServerContext } from "@getpaseo/plugin/server";
import { overlaySettings, prefsSettings } from "./shared/settings";

// No daemon logic: the server entry only enables persistence for the two settings documents.
export default function contribute(server: PluginServerContext) {
  server.registerSettings(prefsSettings);
  server.registerSettings(overlaySettings);
  return () => {};
}
