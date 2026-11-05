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

- One row per chat, from every connected host. Default row: host tag, status light, project,
  workspace and tab name on the first line; git branch and agent on the second.
- Ordered by what needs you: unread chats oldest first, then running chats oldest first, then the most
  recently used inactive chats. Each group has its own limit, and `+N` chips show what is hidden.
- Pinned chats stay at the top in their own section, whatever their state.
- **Inbox pill** in every chat's composer with live counts and the same list as a popup.
- **Later pill** marks the chat you are in as unread and opens the next one.
- Check button on unread rows marks read without opening; clock button on inactive rows marks unread;
  pin button on every row.
- Fuzzy search over title, project, workspace, branch, agent and host. Host chips filter by host, and
  one chip groups rows per host.
- Full list screen, a cog that opens the settings, and a Command Center item.
- Settings: choose, reorder, split over any number of lines and set the length of every row item, with a
  live preview; list limits; the hover card with the full names and its transparency.

## Install

Plugins are trusted code, so read the source first. Then install it from GitHub on the daemon you want it on:

```bash
paseo plugin install github:SeriousM/paseo-recent-chats
```

`--ref <branch, tag or commit>` pins a revision (the default is the repository's default branch), and
`paseo plugin update paseo-recent-chats` pulls newer commits later. Plugins must be enabled on the daemon
(Settings, Plugins). In a desktop or web client the plugin then appears as "Recent Chats" in the sidebar.

## How unread works

A chat is unread when Paseo flags it as needing attention (finished, failed or waiting for a permission)
and you have not opened or dismissed it since. A running chat waiting for a permission counts as unread.
Unread chats older than the expiry (7 days by default) count as inactive.

Plugins cannot change Paseo's own read state, so "Later", "mark read without opening" and pins are stored
by the plugin on the host it runs on. Paseo's own status indicators do not show them.

## Where settings live

On web and desktop the view settings are saved in the browser or app profile you are using, so every host
shows the same view and each device can differ. Phones cannot store them locally, so there they are saved
on the host. Read marks and pins are always saved on the host.

## Limits

- Needs Paseo 0.14.0 or later (daemon and app).
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
storage. `client/web.ts` is the only file that touches a browser global.

## License

MIT
