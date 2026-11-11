import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Checks GitHub for a newer version of this plugin on the host now, and installs it if there is one. */
export const checkForUpdate = defineRpc({
  name: "updates.check",
  input: z.object({}),
  output: z.object({ result: z.string() }),
});

/** The version of this plugin installed from GitHub on the host; null for a local folder install. */
export const installedVersionRpc = defineRpc({
  name: "updates.version",
  input: z.object({}),
  output: z.object({ commit: z.string(), installedAt: z.number() }).nullable(),
});
