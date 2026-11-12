# Recent Chats for Paseo

My chat list got too long to read, so this plugin answers one question: what should I look at next?
It puts a short, ordered inbox of your chats in the sidebar and in a pill next to the composer.

Up front: I used AI to write a good part of the code and to help with the docs. The ideas, the
feature list and the trade-offs are mine. Read the source like any third-party code.

The inbox pill in a chat's composer, with sample data. One click opens the list, one click opens a chat:

![The inbox popup above the composer, with the Inbox and Later pills](assets/screenshot-pill.png)

The settings screen, where every row item can be shown, reordered, split over lines and given a length:

![Row layout editor with a live preview](assets/screenshot-layout.png)

## What it does

- Two views in the sidebar, switched in its first row. **Projects** (the default on wide screens): a
  Needs you strip, a Pinned section, then host → project → workspace → chat, with the branch, checkout
  or worktree and line changes per workspace and the newest 3 chats per workspace. **Triage** (the default
  on phones): the sections below. The choice, **Active only** (hide workspaces outside the inactive window)
  and folds are kept per device.
- Pin a project, a workspace or a chat. The Pinned section shows each pinned item with its parents and
  everything below it; pinned items also stay in place. Pins are synced to every device.
- Drag a project by its folder icon, or a workspace by its grip, to reorder the Projects view; the order is
  synced to every device. Long press or double-click a workspace name to rename it (on its host).
  Collapse, Expand and Active above the tree fold everything, open everything, or open only what is active.
  What the tree shows per workspace and chat (branch, also main/master, checkout or worktree, line
  changes, host tag, age, agent) is a setting.
- Text follows the interface font size set in Paseo (Settings, Appearance) on web and desktop.
- The search button filters the view in place: a matching project keeps everything in it, a matching
  workspace all its chats, a matching chat itself. The Hosts dropdown switches hosts on or off and
  grouping by host (in Projects, off shows a host tag on each project).
- One row per chat, from every connected host. Default row: host tag, status light, project,
  workspace and tab name on the first line; git branch and agent on the second.
- Ordered by what needs you: unread chats oldest first, then running chats oldest first, then the most
  recently used inactive chats. Each group has its own limit, and `+N` chips show what is hidden. Section order and the sort direction in each are settings.
- Pinned chats stay at the top in their own section, whatever their state.
- A chevron on the Pinned, Running and Inactive headings, and on each host heading when grouped by host, folds that group away until you unfold it or restart the app.
- The chat open on screen is highlighted in every list. Plugins are not told which chat is open, so this works while the Inbox or Later pill is shown in its composer.
- Rename a chat in place: long press its row, or double-click it on desktop and web. The new title is saved on the chat's host through its `paseo agent update`, so that host needs a current Recent Chats.
- Opening a waiting chat leaves it in Needs you with a grey light until another chat is open or its state changes, so the list does not jump under the pointer.
- Status symbols in Paseo's own colours: Paseo's turning blue ring while a chat runs, a pulsing amber "?" while it asks you (a question or permission request, also while it runs), a green tick when done and unseen (bold while the agent is in memory, thin once Paseo has released it), a red warning triangle when failed (filled, or outlined once released); inactive chats show how they last ended, in grey.
- **Inbox pill** in every chat's composer with live counts and the same list as a popup.
- **Later pill** marks the chat you are in as unread and opens the next one.
- Check button on unread rows marks read without opening; clock button on inactive rows marks unread;
  pin button on every row.
- Fuzzy search over title, project, workspace, branch, agent and host.
- Full list screen, a cog that opens the settings, and a Command Center item.
- Settings: choose, reorder, split over any number of lines and set the length of every row item, with a
  live preview; list limits; the order of the sections and the sort direction inside each; the hover card with the full names and its transparency.

## Install

Plugins are trusted code, so read the source first. Then install it from GitHub on the daemon you want it on:

```bash
paseo plugin install github:SeriousM/paseo-recent-chats
```

`--ref <branch, tag or commit>` pins a revision (the default is the repository's default branch), and
The plugin updates itself: every host that installed it from GitHub checks a few minutes after start and every 6 hours, and runs `paseo plugin update` when a newer commit exists (Settings, Recent Chats, Updates switches this off). The newest version installed on any host is kept in the synced settings, so as soon as one host updates, the others follow within about a minute while a Paseo app is open. `paseo plugin update paseo-recent-chats` still updates at once. Plugins must be enabled on the daemon
(Settings, Plugins). In a desktop or web client the plugin then appears as "Recent Chats" in the sidebar.

## How unread works

A chat is unread when Paseo flags it as needing attention (finished, failed or waiting for a permission)
and you have not opened or dismissed it since. A running chat waiting for a permission counts as unread.
Unread chats older than the expiry (7 days by default) count as inactive.

Plugins cannot change Paseo's own read state, so "Later", "mark read without opening" and pins are stored
by the plugin, on the host the chat belongs to. Paseo's own status indicators do not show them.
A "Later" mark clears when you open the chat from this plugin; opening it from Paseo's own sidebar does not clear it.

## Where settings live

Install the plugin on every host you connect to. Each host's copy finds the others inside the app, so:

- Pins, Later and read marks are saved on the chat's own host. Every device and every host shows the same.
  While a chat's host is offline or has no copy of the plugin, its marks are kept on the current host and
  move to the chat's host once it is reachable.
- View settings (row layout, limits, list height, and the rest) are saved on every connected host. The most
  recently changed copy wins, so a host that was offline catches up when it is back. List height has
  separate settings for phones and wide screens.
- Settings earlier versions kept in a web or desktop profile are moved to the hosts on first start.

Copies of the plugin reach each other through a shared object in the app, not through a documented Paseo
API. If a future Paseo release isolates them, each host simply keeps its own marks and settings again.

## Limits

- Needs Paseo 0.14.0 or later (daemon and app). Hosts running an older version of this plugin keep their
  own marks and settings until updated.
- Host colours are read from the app's saved host list, so they show on web and desktop only.
- No keyboard shortcuts: plugins cannot register them. Use the Command Center.
- Sub-agents are not listed.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test
paseo plugin install /absolute/path/to/paseo-recent-chats   # a local checkout
```

The plugin has a client entry (all the UI and logic) and a tiny server entry that only enables settings
storage. `client/web.ts` is the only file that touches a browser global. `client/peers.ts` is the shared
directory through which the copies of the plugin on different hosts reach each other; its shape is a
contract between plugin versions.

## License

MIT
