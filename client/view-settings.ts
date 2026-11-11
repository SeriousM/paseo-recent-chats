import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Layout choices of the sidebar view. Kept on this device: a phone and a desktop choose separately. */
export const viewSettings = defineSettings({
  id: "view",
  scope: "device",
  version: 1,
  schema: z.object({
    /** Null until chosen: Triage on phones, Projects on wide screens. */
    mode: z.enum(["projects", "triage"]).nullable().default(null),
    /** Projects mode hides workspaces with nothing inside the inactive window. */
    activeOnly: z.boolean().default(true),
    /**
     * Tree nodes switched from their default: `host:`, `project:` and `workspace:` keys are folded,
     * `older:` keys show all chats of a workspace, `quiet:` keys list a host's quiet projects.
     */
    toggled: z.array(z.string()).default([]),
  }),
});

export type ViewPrefs = z.output<typeof viewSettings.schema>;

export const DEFAULT_VIEW_PREFS: ViewPrefs = viewSettings.schema.parse({});
