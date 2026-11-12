import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Sets a chat's title on the host that owns it. */
export const renameChat = defineRpc({
  name: "chat.rename",
  input: z.object({
    agentId: z.string().regex(/^\w[\w-]*$/),
    title: z.string().trim().min(1).max(200),
  }),
  output: z.object({ title: z.string() }),
});

/** Sets a workspace's title on the host that owns it. */
export const renameWorkspace = defineRpc({
  name: "workspace.rename",
  input: z.object({
    workspaceId: z.string().regex(/^\w[\w-]*$/),
    title: z.string().trim().min(1).max(200),
  }),
  output: z.object({ title: z.string() }),
});
